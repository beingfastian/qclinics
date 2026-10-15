// Checks for the single sign-in (POST /api/auth/login): one form for admin, doctors
// and lab staff. Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "check-login-secret";
process.env.ADMIN_EMAIL = "admin@hmc.com";
process.env.ADMIN_PASSWORD = "admin-pass-1";
process.env.WHATSAPP_PROVIDER = "none";

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_logincheck_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { default: authRoutes } = await import("../routes/authRoutes.js");
const { default: doctorRouter } = await import("../routes/doctorRoute.js");
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { labStaffModel } = await import("../model/labModel.js");
const { default: otpModel } = await import("../model/otpModel.js");

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
const login = async (email, password) =>
  (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();

try {
  await doctorModel.create({ name: "Ahmed Raza", email: "Ahmed.Raza@hmc.com", password: await bcrypt.hash("doctor-pass-1", 10), image: "i", speciality: "General physician", degree: "MBBS", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now() });
  await labStaffModel.create({ name: "Lab One", email: "lab@hmc.com", password: await bcrypt.hash("lab-pass-1", 10), active: true });
  await labStaffModel.create({ name: "Lab Off", email: "laboff@hmc.com", password: await bcrypt.hash("lab-pass-1", 10), active: false });

  let r = await login("admin@hmc.com", "admin-pass-1");
  check("Admin email signs in as admin", r.success && r.role === "admin" && jwt.verify(r.token, process.env.JWT_SECRET).role === "admin");
  const adminToken = r.token;
  r = await login("ADMIN@HMC.COM", "admin-pass-1");
  check("Admin email in capitals still works", r.success && r.role === "admin");
  r = await login("admin@hmc.com", "wrong");
  check("Admin with wrong password is refused", !r.success && r.message === "Invalid email or password");

  r = await login("ahmed.raza@hmc.com", "doctor-pass-1");
  const decoded = r.token && jwt.verify(r.token, process.env.JWT_SECRET);
  check("Doctor signs in (email in other capitals)", r.success && r.role === "doctor" && decoded.role === "doctor" && decoded.id);
  const docToken = r.token;
  r = await login("Ahmed.Raza@hmc.com", "wrong");
  check("Doctor with wrong password is refused", !r.success && r.message === "Invalid email or password");

  r = await login("lab@hmc.com", "lab-pass-1");
  check("Lab staff signs in as lab", r.success && r.role === "lab");
  r = await login("laboff@hmc.com", "lab-pass-1");
  check("Turned-off lab account gets a clear message", !r.success && /turned off/.test(r.message));

  r = await login("nobody@hmc.com", "whatever");
  check("Unknown email: same message as a wrong password", !r.success && r.message === "Invalid email or password");
  r = await login("", "");
  check("Empty form is refused", !r.success);

  // The tokens work on each role's own pages, and only there
  let res = await fetch(base + "/api/doctor/dashboard", { headers: { dtoken: docToken } });
  check("Doctor token opens the doctor dashboard", (await res.json()).success === true);
  res = await fetch(base + "/api/admin/dashboard", { headers: { atoken: docToken } });
  check("Doctor token can't open admin pages", res.status === 401);
  res = await fetch(base + "/api/admin/dashboard", { headers: { atoken: adminToken } });
  check("Admin token opens the admin dashboard", (await res.json()).success === true);

  // Old per-role sign-ins still work
  res = await fetch(base + "/api/doctor/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "Ahmed.Raza@hmc.com", password: "doctor-pass-1" }) });
  check("Old doctor sign-in still works", (await res.json()).success === true);

  // ---- Forgot password ----
  const post = async (path, body) =>
    (await fetch(base + "/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  // Emails are off in checks, so the test "receives" the OTP by putting a known one in place
  const setKnownOtp = (otp) => otpModel.updateOne({ email: "ahmed.raza@hmc.com" }, { otpHash: bcrypt.hashSync(otp, 4) });
  const records = () => otpModel.find({ email: "ahmed.raza@hmc.com" }).lean();
  const backdate = (ms) => otpModel.updateMany({}, [{ $set: { createdAt: { $subtract: ["$createdAt", ms] } } }]);

  r = await post("forgot-password", { email: "  AHMED.raza@HMC.com " });
  check("Reset: email matched regardless of capitals", r.success && (await records()).length === 1);
  r = await post("forgot-password", { email: "nobody@hmc.com" });
  check("Reset: unknown email gets the same answer", r.success && r.message === (await post("forgot-password", { email: "nobody@hmc.com" })).message);
  await post("forgot-password", { email: "ahmed.raza@hmc.com" });
  check("Reset: second request within a minute sends nothing new", (await records())[0].sends === 1);

  await setKnownOtp("123456");
  r = await post("verify-otp", { email: "Ahmed.Raza@hmc.com", otp: "654321" });
  check("Reset: wrong OTP refused", !r.success);
  r = await post("verify-otp", { email: "Ahmed.Raza@hmc.com", otp: "123456" });
  check("Reset: right OTP (email in other capitals) gives a reset token", r.success && r.resetToken);
  const resetToken = r.resetToken;
  r = await post("verify-otp", { email: "ahmed.raza@hmc.com", otp: "123456" });
  check("Reset: an OTP works only once", !r.success);

  r = await post("reset-password", { resetToken, newPassword: "new-pass-123", confirmPassword: "new-pass-123" });
  check("Reset: new password saved", r.success === true, JSON.stringify(r));
  check("Reset: signs in with the new password", (await login("ahmed.raza@hmc.com", "new-pass-123")).success === true);
  check("Reset: old password no longer works", (await login("ahmed.raza@hmc.com", "doctor-pass-1")).success === false);
  r = await post("reset-password", { resetToken, newPassword: "attacker-pass-9", confirmPassword: "attacker-pass-9" });
  check("Reset: the same reset token can't be used again", !r.success && /already used/.test(r.message), JSON.stringify(r));
  check("Reset: password unchanged by the reused token", (await login("ahmed.raza@hmc.com", "new-pass-123")).success === true);

  // Hourly limit: at most 5 OTPs, one a minute
  for (let i = 0; i < 6; i++) {
    await backdate(2 * 60 * 1000);
    await post("forgot-password", { email: "ahmed.raza@hmc.com" });
  }
  const after = await records();
  check("Reset: at most 5 OTPs an hour", after.length === 1 && after[0].sends === 5, JSON.stringify(after.map((x) => x.sends)));
  await otpModel.updateMany({}, { windowStart: new Date(Date.now() - 61 * 60 * 1000) });
  await backdate(2 * 60 * 1000);
  await post("forgot-password", { email: "ahmed.raza@hmc.com" });
  check("Reset: next hour, OTPs can be sent again", (await records())[0].sends === 1);

  // Too many wrong guesses
  await setKnownOtp("111111");
  for (let i = 0; i < 5; i++) await post("verify-otp", { email: "ahmed.raza@hmc.com", otp: "222222" });
  r = await post("verify-otp", { email: "ahmed.raza@hmc.com", otp: "111111" });
  check("Reset: after 5 wrong guesses even the right OTP is refused", !r.success && /Too many/.test(r.message));
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL LOGIN CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
