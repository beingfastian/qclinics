// Checks for the sign-in and password-reset rate limits (middleware/rateLimit.js):
// per account and per IP, shared by every login endpoint, kept in MongoDB so they
// hold across Vercel instances, and never locking people out when the database fails.
// Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "check-ratelimit-secret";
process.env.ADMIN_EMAIL = "admin@hmc.com";
process.env.ADMIN_PASSWORD = "admin-pass-1";
process.env.WHATSAPP_PROVIDER = "none";
// Small limits so the checks run quickly (read when the routes are loaded)
process.env.RATE_LIMIT_AUTH_PER_IP = "5";
process.env.RATE_LIMIT_AUTH_PER_ACCOUNT = "3";
delete process.env.RATE_LIMIT_ENABLED;

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_ratelimitcheck_" + Date.now() });

const express = (await import("express")).default;
const { default: authRoutes } = await import("../routes/authRoutes.js");
const { default: doctorRouter } = await import("../routes/doctorRoute.js");
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: rateLimitModel } = await import("../model/rateLimitModel.js");
const { MongoRateLimitStore } = await import("../middleware/rateLimit.js");

const app = express();
app.use(express.json());
app.set("io", { to: () => ({ emit: () => {} }) });
app.use("/api/auth", authRoutes);
app.use("/api/doctor", doctorRouter);
app.use("/api/admin", adminRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const post = async (path, body) => {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, headers: res.headers, data: await res.json() };
};

try {
  await rateLimitModel.syncIndexes();

  // --- Per account: 3 tries for one email, from anywhere ---
  for (let i = 0; i < 3; i++) await post("/api/auth/login", { email: "Victim@HMC.com", password: "guess" + i });
  let r = await post("/api/auth/login", { email: "victim@hmc.com", password: "guess-4" });
  check("4th sign-in for one account is refused with 429", r.status === 429 && r.data.code === "rate_limited", JSON.stringify(r.data));
  check("The refusal says how long to wait", /Too many attempts\. Please wait \d+ minutes?/.test(r.data.message), r.data.message);
  check("Standard RateLimit headers are sent", Boolean(r.headers.get("ratelimit-policy")));

  // --- Per IP: 5 sign-in requests from one address, whichever accounts ---
  r = await post("/api/auth/login", { email: "other@hmc.com", password: "x" });
  check("Another account from the same IP still gets through (5th request)", r.status === 200 && r.data.success === false, JSON.stringify(r));
  r = await post("/api/auth/login", { email: "third@hmc.com", password: "x" });
  check("6th sign-in request from one IP is refused", r.status === 429);
  r = await post("/api/auth/login", { email: "admin@hmc.com", password: "admin-pass-1" });
  check("Even the right password waits once the IP is limited", r.status === 429);

  // The older per-role sign-ins share the same counters (no unlimited side door)
  r = await post("/api/doctor/login", { email: "someone@hmc.com", password: "x" });
  check("Old doctor sign-in is limited too", r.status === 429);
  r = await post("/api/admin/login", { email: "admin@hmc.com", password: "x" });
  check("Old admin sign-in is limited too", r.status === 429);

  // Password reset has its own counters: a locked sign-in doesn't block "forgot password"
  r = await post("/api/auth/forgot-password", { email: "doc@hmc.com" });
  check("Forgot password still works while sign-in is limited", r.status === 200 && r.data.success === true, JSON.stringify(r));
  for (let i = 0; i < 2; i++) await post("/api/auth/verify-otp", { email: "doc@hmc.com", otp: "000000" });
  r = await post("/api/auth/verify-otp", { email: "doc@hmc.com", otp: "000000" });
  check("Reset requests for one account are limited", r.status === 429, JSON.stringify(r));

  // --- Kept in MongoDB: a new instance (another Vercel function) continues the count ---
  const counters = await rateLimitModel.find({}).lean();
  check("Counters are stored in the database", counters.some((c) => c._id.startsWith("login-ip:") && c.hits >= 6), JSON.stringify(counters));
  check("Each counter is removed when its window ends", counters.every((c) => c.expiresAt > new Date() && c.expiresAt <= new Date(Date.now() + 15 * 60 * 1000)));
  const indexes = await rateLimitModel.collection.indexes();
  check("TTL index cleans old counters", indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0));
  const otherInstance = new MongoRateLimitStore("login-ip");
  otherInstance.init({ windowMs: 15 * 60 * 1000 });
  const ipKey = counters.find((c) => c._id.startsWith("login-ip:"))._id.split(":").slice(1, -1).join(":");
  const before = counters.find((c) => c._id.startsWith("login-ip:")).hits;
  check("A second instance continues the same count", (await otherInstance.increment(ipKey)).totalHits === before + 1);

  // Two first requests of a window at the same moment: both counted, no error
  const fresh = new MongoRateLimitStore("race");
  fresh.init({ windowMs: 60 * 1000 });
  const results = await Promise.all(Array.from({ length: 20 }, () => fresh.increment("k")));
  check("20 simultaneous first requests are all counted", Math.max(...results.map((x) => x.totalHits)) === 20, JSON.stringify(results.map((x) => x.totalHits)));

  // --- The database failing must not lock everyone out ---
  const original = rateLimitModel.findOneAndUpdate;
  rateLimitModel.findOneAndUpdate = () => { throw new Error("database unreachable"); };
  const errorLog = console.error;
  console.error = () => {};
  r = await post("/api/auth/forgot-password", { email: "new-person@hmc.com" });
  console.error = errorLog;
  rateLimitModel.findOneAndUpdate = original;
  check("If the counter can't be saved, the request still goes through", r.status === 200, JSON.stringify(r));

  // --- Off switch ---
  process.env.RATE_LIMIT_ENABLED = "false";
  r = await post("/api/auth/login", { email: "admin@hmc.com", password: "admin-pass-1" });
  check("RATE_LIMIT_ENABLED=false turns the limits off", r.status === 200 && r.data.success === true, JSON.stringify(r));
  delete process.env.RATE_LIMIT_ENABLED;
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL RATE LIMIT CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
