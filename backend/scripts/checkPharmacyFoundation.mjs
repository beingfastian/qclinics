// Checks for the pharmacy module's foundation, through the real expressApp.js in all
// three ways a deployment can run (each in its own process, since the mode is read
// at start):
//   hospital            the default: nothing about the hospital changes, no pharmacy
//   hospital+pharmacy   PHARMACY_ENABLED=true: pharmacy logins and API, hospital as before
//   pharmacy            APP_MODE=pharmacy: a standalone pharmacy, no hospital routes
// Covers: app config, pharmacy staff accounts (owner only, validation, duplicates),
// sign-in, roles and permissions read live from the database, other logins refused.
// Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Each mode uses its own throwaway database and deletes it. Never loads .env.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const scriptPath = fileURLToPath(import.meta.url);
const backendDir = path.resolve(path.dirname(scriptPath), "..");
const mode = process.argv[2];

// --- Parent: run each mode in its own process and add up the results ---
if (!mode) {
  let failed = 0;
  for (const [name, extra] of [
    ["hospital", {}],
    ["hospital+pharmacy", { PHARMACY_ENABLED: "true" }],
    ["pharmacy", { APP_MODE: "pharmacy", PHARMACY_NAME: "Al-Shifa Pharmacy" }],
  ]) {
    const output = await new Promise((resolve) => {
      let text = "";
      const child = spawn(process.execPath, [scriptPath, name], {
        cwd: backendDir,
        env: {
          ...process.env,
          DOTENV_CONFIG_PATH: path.join(backendDir, "no-such-env-file"),
          MONGODB_URI: baseUri,
          MONGODB_DB_NAME: `qclinics_pharmacycheck_${name.replace(/\W/g, "")}_${Date.now()}`,
          JWT_SECRET: "check-pharmacy-secret",
          ADMIN_EMAIL: "owner@shop.pk",
          ADMIN_PASSWORD: "owner-pass-1",
          RECEPTION_EMAIL: "desk@shop.pk",
          RECEPTION_PASSWORD: "desk-pass-1",
          WHATSAPP_PROVIDER: "none",
          RATE_LIMIT_AUTH_PER_IP: "1000",
          RATE_LIMIT_AUTH_PER_ACCOUNT: "1000",
          APP_MODE: "",
          PHARMACY_ENABLED: "",
          ...extra,
        },
      });
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("exit", (code) => resolve({ text, code }));
    });
    process.stdout.write(output.text.split("\n").filter((l) => /^(PASS|FAIL|CRASH)/.test(l)).map((l) => l.replace(/^(PASS|FAIL)  /, `$1  [${name}] `)).join("\n") + "\n");
    if (output.code !== 0) failed++;
  }
  console.log(failed ? `\n${failed} MODE(S) FAILED` : "\nALL PHARMACY FOUNDATION CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}

// --- Child: one mode ---
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const { default: app } = await import("../expressApp.js");
const mongoose = (await import("mongoose")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { default: doctorModel } = await import("../model/doctorModel.js");
const { pharmacyStaffModel } = await import("../modules/pharmacy/models/staffModel.js");
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-pharmacy-secret", { expiresIn: "1h" });
const owner = { atoken: sign({ role: "admin" }) };
const reception = { atoken: sign({ role: "reception" }) };
const login = (email, password) => call("POST", "/api/auth/login", {}, { email, password });

try {
  // Make sure the database is connected before writing directly
  await call("GET", "/api/admin/dashboard", owner);
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  await pharmacyStaffModel.init();
  const doctor = await doctorModel.create({
    name: "Imran", email: "imran@shop.pk", password: await bcrypt.hash("doctor-pass-1", 10), image: "i", speciality: "GP",
    degree: "MBBS", experience: "5", about: "a", fee: 1000, address: {}, date: Date.now(),
  });
  const doctorH = { dtoken: sign({ id: String(doctor._id), role: "doctor" }) };

  let r = await call("GET", "/api/app/config");
  const config = r.data?.config;

  if (mode === "hospital") {
    check("App config: hospital, pharmacy off", config?.mode === "hospital" && config.modules.hospital && !config.modules.pharmacy && config.modules.lab && config.modules.billing, JSON.stringify(config));
    r = await call("GET", "/api/pharmacy/status");
    check("Pharmacy status says off", r.status === 200 && r.data.enabled === false);
    r = await call("GET", "/api/pharmacy/me", owner);
    check("Pharmacy API isn't there when off", r.status === 404);
    r = await call("GET", "/api/admin/dashboard", owner);
    check("Hospital routes work as before", r.status === 200 && r.data.success);
    await pharmacyStaffModel.create({ name: "Ali", email: "ali@shop.pk", password: await bcrypt.hash("cashier-pass-1", 10), role: "cashier" });
    r = await login("ali@shop.pk", "cashier-pass-1");
    check("Pharmacy staff can't sign in while the module is off", !r.data.success);
    r = await login("imran@shop.pk", "doctor-pass-1");
    check("Doctors still sign in", r.data.success && r.data.role === "doctor");
    r = await login("desk@shop.pk", "desk-pass-1");
    check("Reception still signs in", r.data.success && r.data.role === "reception");
  }

  if (mode === "hospital+pharmacy") {
    check("App config: hospital with pharmacy", config?.mode === "hospital" && config.modules.hospital && config.modules.pharmacy, JSON.stringify(config));
    r = await call("GET", "/api/admin/dashboard", owner);
    check("Hospital routes work as before", r.status === 200 && r.data.success);

    // Staff accounts: owner only, validated
    r = await call("POST", "/api/pharmacy/staff", owner, { name: "  Sara  ", email: "SARA@Shop.pk", password: "manager-pass-1", role: "manager" });
    check("Owner creates a manager (name trimmed, email lower-case)", r.status === 200 && r.data.staff.name === "Sara" && r.data.staff.email === "sara@shop.pk" && r.data.staff.role === "manager", JSON.stringify(r.data));
    check("Passwords are never returned", !("password" in r.data.staff));
    r = await call("POST", "/api/pharmacy/staff", owner, { name: "Ali", email: "ali@shop.pk", password: "cashier-pass-1", role: "cashier" });
    const cashierId = r.data.staff?._id;
    check("Owner creates a cashier", r.status === 200 && r.data.staff.role === "cashier");
    r = await call("POST", "/api/pharmacy/staff", owner, { name: "X", email: "not-an-email", password: "short", role: "boss" });
    check("Bad input: 400 with each field explained", r.status === 400 && r.data.code === "invalid" && r.data.fields.email && r.data.fields.password && r.data.fields.role, JSON.stringify(r.data));
    r = await call("POST", "/api/pharmacy/staff", owner, { name: "Sara 2", email: "sara@shop.pk", password: "manager-pass-1", role: "manager" });
    check("Same email twice: 409", r.status === 409 && r.data.code === "email_taken");
    const twin = { name: "Twin", email: "twin@shop.pk", password: "twin-pass-123", role: "cashier" };
    const both = await Promise.all([call("POST", "/api/pharmacy/staff", owner, twin), call("POST", "/api/pharmacy/staff", owner, twin)]);
    check("Same email at the same moment: one created, the other 409", both.filter((x) => x.status === 200).length === 1 && both.some((x) => x.status === 409), JSON.stringify(both.map((x) => x.status)));
    r = await call("GET", "/api/pharmacy/staff", owner);
    check("Owner lists staff (no passwords)", r.data.staff.length === 3 && r.data.staff.every((s) => !s.password));
    r = await call("GET", "/api/pharmacy/staff", reception);
    check("Reception can't manage pharmacy staff", r.status === 403);
    r = await call("PUT", "/api/pharmacy/staff/not-an-id", owner, { active: false });
    check("Unknown staff id: 400", r.status === 400);
    r = await call("PUT", `/api/pharmacy/staff/${new mongoose.Types.ObjectId()}`, owner, { active: false });
    check("Missing staff: 404", r.status === 404);

    // Sign-in and roles
    r = await login("sara@shop.pk", "manager-pass-1");
    check("Manager signs in through the shared sign-in", r.data.success && r.data.role === "pharmacy");
    const managerH = { ptoken: r.data.token };
    r = await login("ali@shop.pk", "cashier-pass-1");
    const cashierH = { ptoken: r.data.token };
    r = await login("ali@shop.pk", "wrong-password");
    check("Wrong password: the usual message", !r.data.success && r.data.message === "Invalid email or password");
    r = await call("GET", "/api/pharmacy/me", managerH);
    check("Manager: may see profit and manage stock", r.data.user.role === "manager" && r.data.user.permissions.includes("viewProfit") && r.data.user.permissions.includes("manageStock"));
    r = await call("GET", "/api/pharmacy/me", cashierH);
    check("Cashier: may sell, not see profit", r.data.user.role === "cashier" && r.data.user.permissions.includes("sell") && !r.data.user.permissions.includes("viewProfit"));
    r = await call("GET", "/api/pharmacy/me", owner);
    check("Owner may do everything", r.data.user.role === "owner" && r.data.user.permissions.includes("overrideNegativeStock"));
    r = await call("GET", "/api/pharmacy/staff", managerH);
    check("A manager can't manage staff accounts (owner only)", r.status === 403);
    r = await call("GET", "/api/pharmacy/me", doctorH);
    check("A doctor's login can't use the pharmacy (not a pharmacy login)", r.status === 401 || r.status === 403, String(r.status));
    r = await call("GET", "/api/pharmacy/me", { ptoken: sign({ id: String(doctor._id), role: "doctor" }) });
    check("A doctor's token in the pharmacy header can't either", r.status === 403);
    r = await call("GET", "/api/pharmacy/me");
    check("No login: 401", r.status === 401);
    r = await call("GET", "/api/admin/dashboard", { atoken: cashierH.ptoken });
    check("A pharmacy login can't open hospital pages", r.status === 401 || r.status === 403);

    // Changes take effect at once (read from the database on every request)
    await call("PUT", `/api/pharmacy/staff/${cashierId}`, owner, { role: "manager" });
    r = await call("GET", "/api/pharmacy/me", cashierH);
    check("Role change applies immediately, same login", r.data.user.role === "manager");
    await call("PUT", `/api/pharmacy/staff/${cashierId}`, owner, { active: false });
    r = await call("GET", "/api/pharmacy/me", cashierH);
    check("Turned-off account stops working immediately", r.status === 401);
    r = await login("ali@shop.pk", "cashier-pass-1");
    check("Turned-off account can't sign in (clear message)", !r.data.success && /turned off/.test(r.data.message));
    r = await call("PUT", `/api/pharmacy/staff/${cashierId}`, owner, {});
    check("An update with nothing to change: 400", r.status === 400);
  }

  if (mode === "pharmacy") {
    check("App config: standalone pharmacy with its own name", config?.mode === "pharmacy" && !config.modules.hospital && config.modules.pharmacy && !config.modules.lab && !config.modules.billing && config.name === "Al-Shifa Pharmacy", JSON.stringify(config));
    for (const [p, h] of [["/api/admin/dashboard", owner], ["/api/doctor/dashboard", doctorH], ["/api/queue/public/board", {}], ["/api/lab/status", {}], ["/api/billing/status", {}], ["/api/notifications", owner], ["/api/cron/reminders", {}]]) {
      r = await call("GET", p, h);
      check(`No hospital route: ${p} -> 404`, r.status === 404, String(r.status));
    }
    r = await call("GET", "/api/pharmacy/status");
    check("Pharmacy is on", r.data.enabled === true);
    r = await login("owner@shop.pk", "owner-pass-1");
    check("The owner signs in", r.data.success && r.data.role === "admin");
    r = await call("POST", "/api/pharmacy/staff", owner, { name: "Bilal", email: "bilal@shop.pk", password: "cashier-pass-1", role: "cashier" });
    check("The owner creates a cashier", r.status === 200);
    r = await login("bilal@shop.pk", "cashier-pass-1");
    check("The cashier signs in", r.data.success && r.data.role === "pharmacy");
    r = await login("imran@shop.pk", "doctor-pass-1");
    check("Doctors can't sign in to a standalone pharmacy", !r.data.success);
    r = await login("desk@shop.pk", "desk-pass-1");
    check("Hospital reception can't sign in to a standalone pharmacy", !r.data.success);
  }
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}
