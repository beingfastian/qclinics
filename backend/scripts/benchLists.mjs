// Volume benchmark for the list screens: how big and how slow the appointment,
// patient and doctor-dashboard responses get once a hospital has a few years of data.
// Not part of check:integration (it takes a while); run it before and after a
// change to the list endpoints:
//
//   node scripts/benchLists.mjs
//   BENCH_APPOINTMENTS=100000 BENCH_PATIENTS=50000 node scripts/benchLists.mjs
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "bench-lists-secret";
process.env.ADMIN_EMAIL = "admin@hmc.com";
process.env.ADMIN_PASSWORD = "admin-pass-1";
process.env.WHATSAPP_PROVIDER = "none";

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_benchlists_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: doctorRouter } = await import("../routes/doctorRoute.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: userModel } = await import("../model/userModel.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const { hospitalSlotDate } = await import("../utils/slots.js");

const APPOINTMENTS = Number(process.env.BENCH_APPOINTMENTS || 40000);
const PATIENTS = Number(process.env.BENCH_PATIENTS || 20000);
const DOCTORS = 8;
const DAYS_BACK = 730; // two years of history
const DAYS_AHEAD = 30;
const RUNS = Number(process.env.BENCH_RUNS || 5);

const app = express();
app.use(express.json());
app.set("io", { to: () => ({ emit: () => {} }) });
app.use("/api/admin", adminRouter);
app.use("/api/doctor", doctorRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// --- Seed (realistic sizes: appointments carry patient/doctor snapshots, history, notifications) ---
const t0 = Date.now();
const doctors = await doctorModel.insertMany(
  Array.from({ length: DOCTORS }, (_, i) => ({
    name: `Doctor ${i + 1}`,
    email: `doctor${i + 1}@hmc.com`,
    password: "$2b$10$abcdefghijklmnopqrstuuvwxyzabcdefghijklmnopqrstuvwxyz12",
    image: `https://res.cloudinary.com/demo/image/upload/v1/doctors/doctor${i + 1}.jpg`,
    speciality: ["General physician", "Gynecologist", "Pediatrician", "Dermatologist"][i % 4],
    degree: "MBBS, FCPS",
    experience: `${5 + i} Years`,
    about: "Experienced consultant who sees patients for general and specialist care. ".repeat(4),
    fee: 1000 + i * 250,
    address: { line1: "Haram Medical Complex", line2: "Main Road, City" },
    date: Date.now(),
    timings: { start: "09:00", end: "17:00" },
    hospitalSharePercent: 30,
  }))
);

const patientDocs = Array.from({ length: PATIENTS }, (_, i) => ({
  name: `Patient ${i + 1} ${["Khan", "Ahmed", "Ali", "Hussain", "Malik"][i % 5]}`,
  phone: `0300${String(1000000 + i).slice(-7)}`,
  whatsappNumber: `0300${String(1000000 + i).slice(-7)}`,
  whatsappEnabled: i % 3 !== 0,
  dob: `19${50 + (i % 50)}-0${1 + (i % 9)}-1${i % 9}`,
  gender: i % 2 ? "Female" : "Male",
  address: { line1: `House ${i}, Street ${i % 40}`, line2: "City" },
  language: i % 2 ? "ur" : "en",
  createdAt: new Date(),
}));
for (let i = 0; i < patientDocs.length; i += 5000) {
  await userModel.collection.insertMany(patientDocs.slice(i, i + 5000));
}
const patients = await userModel.find({}).lean();

const now = Date.now();
const TIMES = ["09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "02:00 PM", "03:00 PM", "04:00 PM"];
const appointmentDocs = [];
for (let i = 0; i < APPOINTMENTS; i++) {
  const doctor = doctors[i % DOCTORS].toObject();
  delete doctor.password;
  delete doctor.slots_booked;
  const patient = patients[i % patients.length];
  const dayOffset = Math.floor((i / APPOINTMENTS) * (DAYS_BACK + DAYS_AHEAD)) - DAYS_BACK;
  const startAt = new Date(now + dayOffset * 86400000);
  const past = dayOffset < 0;
  const status = !past ? "booked" : ["completed", "completed", "completed", "cancelled", "no_show"][i % 5];
  const actor = { role: "admin" };
  appointmentDocs.push({
    userId: String(patient._id),
    docId: String(doctor._id),
    slotDate: hospitalSlotDate(startAt),
    slotTime: TIMES[i % TIMES.length],
    startAt,
    durationMinutes: 30,
    userData: patient,
    docData: doctor,
    amount: doctor.fee,
    date: startAt.getTime() - 3 * 86400000,
    status,
    cancelled: status === "cancelled",
    isCompleted: status === "completed",
    ...(status === "completed" && { completedAt: startAt, share: { percent: 30, hospital: doctor.fee * 0.3, doctor: doctor.fee * 0.7 } }),
    type: ["new", "new", "follow_up", "walk_in"][i % 4],
    createdBy: actor,
    history: [
      { at: new Date(startAt.getTime() - 3 * 86400000), by: actor, action: "booked", to: { slotDate: hospitalSlotDate(startAt), slotTime: TIMES[i % TIMES.length] } },
      ...(past ? [{ at: startAt, by: actor, action: "checked_in" }] : []),
      ...(status !== "booked" ? [{ at: startAt, by: actor, action: status === "completed" ? "completed" : status }] : []),
    ],
    notifications: [
      { at: startAt, channel: "whatsapp", recipient: "patient", kind: "confirmation", status: "sent" },
      { at: startAt, channel: "email", recipient: "doctor", kind: "confirmation", status: "sent" },
    ],
  });
}
for (let i = 0; i < appointmentDocs.length; i += 5000) {
  await appointmentModel.collection.insertMany(appointmentDocs.slice(i, i + 5000));
}
await appointmentModel.syncIndexes();
await userModel.syncIndexes();
console.log(`Seeded ${DOCTORS} doctors, ${PATIENTS} patients, ${APPOINTMENTS} appointments in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// --- Measure ---
const adminHeaders = { atoken: jwt.sign({ role: "admin" }, process.env.JWT_SECRET) };
const doctorHeaders = { dtoken: jwt.sign({ id: String(doctors[0]._id), role: "doctor" }, process.env.JWT_SECRET) };

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = async (label, path, headers) => {
  const times = [];
  let bytes = 0;
  let rows = "";
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    const res = await fetch(base + path, { headers });
    const text = await res.text();
    times.push(performance.now() - started);
    bytes = Buffer.byteLength(text);
    const data = JSON.parse(text);
    if (!data.success) throw new Error(`${path}: ${data.message}`);
    const list = data.appointments || data.patients || data.dashData?.latestAppointments;
    rows = Array.isArray(list) ? String(list.length) : "";
  }
  console.log(
    `${label.padEnd(44)} ${String(Math.round(median(times))).padStart(6)} ms  ${(bytes / 1048576).toFixed(2).padStart(7)} MB  ${rows.padStart(6)} rows`
  );
};

console.log(`${"Endpoint".padEnd(44)} ${"median".padStart(9)}  ${"size".padStart(10)}  ${"rows".padStart(6)}   (${RUNS} runs each)`);
await measure("GET /api/admin/appointments", "/api/admin/appointments", adminHeaders);
await measure("GET /api/admin/all-patients", "/api/admin/all-patients", adminHeaders);
await measure("GET /api/doctor/appointments (one doctor)", "/api/doctor/appointments", doctorHeaders);
await measure("GET /api/doctor/dashboard (one doctor)", "/api/doctor/dashboard", doctorHeaders);
const extra = process.env.BENCH_EXTRA_PATHS; // e.g. "admin:/api/admin/appointments?range=today"
for (const entry of (extra || "").split(",").filter(Boolean)) {
  const [who, path] = entry.split(/:(.+)/);
  await measure(`GET ${path}`, path, who === "doctor" ? doctorHeaders : adminHeaders);
}
console.log(`\nServer memory (RSS): ${Math.round(process.memoryUsage().rss / 1048576)} MB`);

server.close();
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
