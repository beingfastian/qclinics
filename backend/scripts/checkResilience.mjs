// Checks that a Vercel instance survives a database it can't reach at first
// (seen in production: "Could not connect to any servers" on a new instance):
// it stays up, requests that don't need the database still work, the others get
// a clear 503, and it recovers by itself once the database answers. Also the CORS
// cache and the /api/live switch. Uses the real expressApp.js, never the .env file.
// Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI)
// for the recovery part. Uses its own throwaway database and deletes it at the end.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEAD_DB = "mongodb://127.0.0.1:9/"; // nothing listens there
const env = {
  DOTENV_CONFIG_PATH: path.join(backendDir, "no-such-env-file"), // never load the real .env
  MONGODB_URI: DEAD_DB,
  MONGODB_DB_NAME: "qclinics_resiliencecheck_" + Date.now(),
  JWT_SECRET: "check-resilience-secret",
  ADMIN_EMAIL: "admin@hmc.com",
  ADMIN_PASSWORD: "admin-pass-1",
  WHATSAPP_PROVIDER: "none",
  CORS_ORIGINS: "http://staff.test/, https://hmc-*-hanzla-iqbals-projects.vercel.app",
  DB_CONNECT_ATTEMPTS: "2",
  DB_SERVER_TIMEOUT_MS: "700",
  DB_WAIT_MS: "4000",
};

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};

// --- An always-on server (not Vercel) still exits when the database is unreachable ---
const exitCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", 'await import("./expressApp.js");'], {
    cwd: backendDir,
    env: { ...process.env, ...env, VERCEL: "" },
    stdio: "ignore",
  });
  const timer = setTimeout(() => {
    child.kill();
    resolve("still running");
  }, 15000);
  child.on("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});
check("Always-on server: an unreachable database at start still exits (host restarts it)", exitCode === 1, String(exitCode));

// --- Production warnings for risky settings (logged; the server still starts) ---
const warnings = await new Promise((resolve) => {
  let output = "";
  const child = spawn(process.execPath, ["--input-type=module", "-e", 'await import("./expressApp.js"); console.log("STARTED");'], {
    cwd: backendDir,
    env: { ...process.env, ...env, VERCEL: "1", VERCEL_ENV: "production", CORS_ORIGINS: "", JWT_SECRET: "short-secret" },
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  setTimeout(() => {
    child.kill();
    resolve(output);
  }, 4000);
});
check("Production without CORS_ORIGINS logs a warning", /CORS_ORIGINS is not set/.test(warnings));
check("Production with a short JWT_SECRET logs a warning", /JWT_SECRET is shorter than 32/.test(warnings));
check("…and still starts (the live app stays up)", /STARTED/.test(warnings));

// --- Vercel: the instance must stay up ---
Object.assign(process.env, env, { VERCEL: "1" });
const exits = [];
const realExit = process.exit;
process.exit = (code) => {
  exits.push(code);
};
const errorLog = console.error;
const connectErrors = [];
console.error = (...args) => connectErrors.push(args.join(" "));

const { default: app } = await import("../expressApp.js");
const mongoose = (await import("mongoose")).default;
const jwt = (await import("jsonwebtoken")).default;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const admin = { atoken: jwt.sign({ role: "admin" }, env.JWT_SECRET) };
const get = async (p, headers = {}) => {
  const started = Date.now();
  const res = await fetch(base + p, { headers });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null), ms: Date.now() - started };
};

try {
  let r = await fetch(base + "/");
  check("Database down: the health check still answers", r.status === 200 && (await r.text()) === "API Working");

  // Security headers (helmet), chosen so lab report previews keep working: the staff
  // app shows reports from this API in an <iframe>/<img> and opens PDFs in a new tab
  const h = r.headers;
  check("Security headers: HTTPS only (HSTS)", /max-age=\d+/.test(h.get("strict-transport-security") || ""), h.get("strict-transport-security"));
  check("Security headers: no MIME sniffing", h.get("x-content-type-options") === "nosniff");
  check("Security headers: no referrer leaks", h.get("referrer-policy") === "no-referrer");
  check("Security headers: the server software isn't advertised", !h.get("x-powered-by"));
  check("Report previews keep working: may be embedded by the staff app (no X-Frame-Options, no CSP)", !h.get("x-frame-options") && !h.get("content-security-policy"));
  check("Report previews keep working: images/PDFs may load from the staff app's domain", h.get("cross-origin-resource-policy") === "cross-origin");
  check("Reports opened in a new tab keep working (no opener policy)", !h.get("cross-origin-opener-policy"));
  r = await get("/api/billing/status");
  check("Database down: billing on/off status still answers (no database needed)", r.status === 200 && r.body?.success === true, JSON.stringify(r.body));
  r = await get("/api/live");
  check("/api/live tells the staff app there are no live updates on Vercel", r.status === 200 && r.body?.live === false);

  const pre = await fetch(base + "/api/admin/dashboard", {
    method: "OPTIONS",
    headers: { Origin: "http://staff.test", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "atoken" },
  });
  check("CORS check answers at once even with the database down", pre.status === 204);
  check("Browsers may remember the CORS check for 2 hours", pre.headers.get("access-control-max-age") === "7200", pre.headers.get("access-control-max-age"));

  // CORS_ORIGINS: exact addresses (a trailing slash is fine) and "*" for preview deployments
  const allowedFor = async (origin) =>
    (await fetch(base + "/api/admin/dashboard", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "atoken" },
    })).headers.get("access-control-allow-origin") === origin;
  check("CORS: the configured staff app address is allowed", await allowedFor("http://staff.test"));
  check("CORS: a preview deployment matching the wildcard is allowed", await allowedFor("https://hmc-4xteorkc8-hanzla-iqbals-projects.vercel.app"));
  const lookalikes = [
    "https://evil.example",
    "https://hmc-4xteorkc8-hanzla-iqbals-projects.vercel.app.evil.example",
    "https://evilhmc-4x-hanzla-iqbals-projects.vercel.app",
    "https://hmc-a.evil-hanzla-iqbals-projects.vercel.app",
    "http://hmc-4xteorkc8-hanzla-iqbals-projects.vercel.app",
    "https://hmc--hanzla-iqbals-projects.vercel.app",
  ];
  const leaked = [];
  for (const origin of lookalikes) if (await allowedFor(origin)) leaked.push(origin);
  check("CORS: other and lookalike addresses are refused", leaked.length === 0, leaked.join(" "));

  r = await get("/api/admin/dashboard", admin);
  check("Database down: a database route gets a clear 503 (not a crash)", r.status === 503 && r.body?.code === "db_unavailable" && /try again/.test(r.body?.message), `${r.status} ${JSON.stringify(r.body)}`);
  check("The 503 says when to retry", r.headers.get("retry-after") === "3");
  check("It answers within the wait limit", r.ms < 7000, `${r.ms} ms`);
  const [a, b] = await Promise.all([get("/api/admin/dashboard", admin), get("/api/admin/all-doctors", admin)]);
  check("Requests at the same time all get the 503", a.status === 503 && b.status === 503);
  check("The instance never called process.exit", exits.length === 0, JSON.stringify(exits));
  check("Each failed try is logged", connectErrors.some((m) => /Database connection failed \(try 1 of 2\)/.test(m)), connectErrors.slice(0, 2).join(" | "));

  // --- The database becomes reachable: the next request connects, no restart needed ---
  process.env.MONGODB_URI = baseUri;
  r = await get("/api/admin/dashboard", admin);
  check("Database back: the next request connects and succeeds", r.status === 200 && r.body?.success === true, `${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
  check("Connected for the following requests", mongoose.connection.readyState === 1);
  r = await get("/api/admin/appointments?range=today", admin);
  check("Other database routes work too", r.status === 200 && r.body?.success === true);

  // A warm instance whose connection dropped (seen in production: a Vercel instance
  // thawed with a dead connection kept answering 503 for 25+ minutes). The next
  // request must reconnect, not wait forever for a reconnect that never comes.
  const listenersBefore = mongoose.connection.listenerCount("connected");
  await mongoose.connection.close();
  check("(simulated) the connection is down", mongoose.connection.readyState === 0);
  r = await get("/api/admin/dashboard", admin);
  check("After a dropped connection, the next request reconnects and succeeds", r.status === 200 && r.body?.success === true, `${r.status} ${JSON.stringify(r.body)?.slice(0, 100)}`);
  await mongoose.connection.close();
  await Promise.all(Array.from({ length: 15 }, () => get("/api/admin/dashboard", admin)));
  check("Many requests while reconnecting don't pile up listeners", mongoose.connection.listenerCount("connected") <= listenersBefore + 1, `${listenersBefore} -> ${mongoose.connection.listenerCount("connected")}`);
  check("Connected again", mongoose.connection.readyState === 1);

  // --- Public queue routes: cached a few seconds, open to any website ---
  const fromSite = { Origin: "https://hospital-site.example" };
  r = await get("/api/queue/public/board", fromSite);
  check("Waiting-room board is cached at the edge for 5 s", r.status === 200 && /s-maxage=5/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
  check("Public board answers any website (patient site, waiting-room TV)", r.headers.get("access-control-allow-origin") === "*" && !/origin/i.test(r.headers.get("vary") || ""));
  r = await get("/api/queue/public/token/zzzzzzzz", fromSite);
  check("Unknown token: 404 and never cached", r.status === 404 && r.headers.get("cache-control") === "no-store");
  r = await get("/api/admin/dashboard", { ...admin, ...fromSite });
  check("Private routes still refuse other websites", !r.headers.get("access-control-allow-origin"));
  let reads = 0;
  mongoose.set("debug", (collection, method) => { if (collection === "queuetokens" && method === "distinct") reads++; });
  await new Promise((resolve) => setTimeout(resolve, 3100)); // past the board's 3 s cache
  await Promise.all(Array.from({ length: 10 }, () => get("/api/queue/public/board")));
  check("10 screens asking at once share one database read", reads === 1, String(reads));
  await get("/api/queue/public/board");
  check("Within 3 s the board is served from memory", reads === 1, String(reads));
  await new Promise((resolve) => setTimeout(resolve, 3100));
  await get("/api/queue/public/board");
  check("After 3 s the board is read again (stays current)", reads === 2, String(reads));
  mongoose.set("debug", false);
} catch (error) {
  errorLog("TEST CRASHED:", error);
  failures++;
} finally {
  await new Promise((resolve) => setTimeout(resolve, 1500)); // let the startup migration finish
  console.error = errorLog;
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit = realExit;
  console.log(failures ? `\n${failures} FAILED` : "\nALL RESILIENCE CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
