// Checks for the "Today" numbers on the admin and doctor dashboards, through the
// real HTTP routes. Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "check-today-secret";
process.env.WHATSAPP_PROVIDER = "none";
process.env.HOSPITAL_UTC_OFFSET_MINUTES = "300";

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_todaycheck_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: doctorRouter } = await import("../routes/doctorRoute.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: userModel } = await import("../model/userModel.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const { hospitalSlotDate } = await import("../utils/slots.js");
const q = await import("../services/queueService.js");

const app = express();
app.use(express.json());
app.set("io", { to: () => ({ emit: () => {} }) });
app.use("/api/admin", adminRouter);
app.use("/api/doctor", doctorRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const get = async (url, token) => (await fetch(base + url, { headers: token })).json();

try {
  const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1h" });
  const admin = { atoken: sign({ role: "admin" }) };
  const doctor = (name, email) =>
    doctorModel.create({ name, email, password: "x", image: "i", speciality: "Medicine", degree: "d", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now() });
  const iqbal = await doctor("Muhammad Iqbal", "iqbal@test.pk");
  const sana = await doctor("Sana Malik", "sana@test.pk");
  const patient = await userModel.create({ name: "Aslam", phone: "03001234567" });
  const today = hospitalSlotDate(new Date());

  const booking = (doc, slotDate, slotTime, extra = {}) =>
    appointmentModel.create({
      userId: String(patient._id), docId: String(doc._id), slotDate, slotTime, startAt: new Date(),
      userData: { name: patient.name }, docData: { name: doc.name }, amount: 1000, date: Date.now(), status: "booked", ...extra,
    });
  await booking(iqbal, today, "09:00 AM");
  await booking(iqbal, today, "09:30 AM", { isCompleted: true, status: "completed" });
  await booking(iqbal, today, "10:00 AM", { status: "no_show" });
  await booking(iqbal, today, "10:30 AM", { cancelled: true, status: "cancelled" });
  await booking(iqbal, "1_1_2020", "10:30 AM"); // another day: not counted

  // Two walk-ins in the queue; the first one is called in
  const first = (await q.issueToken({ docId: String(iqbal._id), patientName: "Walk-in One", fee: 1000, actor: { role: "admin" } })).token;
  await q.issueToken({ docId: String(iqbal._id), patientName: "Walk-in Two", fee: 1000, actor: { role: "admin" } });
  await q.callNext(String(iqbal._id), { role: "admin" }, String(first._id), "");

  const adminDash = await get("/api/admin/dashboard", admin);
  const rows = adminDash.dashData?.todayDoctors?.doctors || [];
  const row = rows.find((r) => r.name === "Muhammad Iqbal");
  check("Admin dashboard lists every doctor for today", rows.length === 2, JSON.stringify(rows.map((r) => r.name)));
  check("Busiest doctor first", rows[0]?.name === "Muhammad Iqbal");
  check(
    "Per-doctor counts: 3 to see (1 booked + 2 walk-ins), 1 seen, 1 no-show, 1 cancelled",
    row && row.toSee === 3 && row.seen === 1 && row.noShow === 1 && row.cancelled === 1,
    JSON.stringify(row)
  );
  check("Queue: 1 waiting, now serving token 1", row && row.waiting === 1 && row.nowServing === first.number, JSON.stringify(row));
  check("Doctor with nothing today shows zeros", rows[1]?.toSee === 0 && rows[1]?.waiting === 0 && rows[1]?.nowServing === null);
  check("Totals add up", adminDash.dashData.todayDoctors.totals.toSee === 3 && adminDash.dashData.todayDoctors.totals.seen === 1);
  check("Pending leave count is a number", adminDash.dashData.pendingLeave === 0);
  check("Existing dashboard fields unchanged", typeof adminDash.dashData.doctors === "number" && Array.isArray(adminDash.dashData.latestAppointments));

  await q.setPaused(String(iqbal._id), true, "Tea");
  const docDash = await get("/api/doctor/dashboard", { dtoken: sign({ role: "doctor", id: String(iqbal._id) }) });
  const mine = docDash.dashData?.today;
  check("Doctor dashboard has only their own today", mine && mine.docId === String(iqbal._id) && mine.toSee === 3 && mine.waiting === 1);
  check("Doctor dashboard shows the break", mine?.paused === true);
  const sanaDash = await get("/api/doctor/dashboard", { dtoken: sign({ role: "doctor", id: String(sana._id) }) });
  check("Other doctor sees none of it", sanaDash.dashData?.today?.toSee === 0 && sanaDash.dashData?.today?.waiting === 0);
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL TODAY CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
