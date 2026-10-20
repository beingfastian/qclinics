// Checks for the paged appointment lists (services/appointmentListService.js).
// The main check: for every combination of filters, paging through the API gives
// exactly the appointments the screens used to show when they loaded everything
// and filtered in the browser (that logic is copied below from AllAppointments.jsx
// and DoctorAppointments.jsx). Also: counts, summary, doctor isolation, the old
// unpaged response, the startAt migration, and that queries use indexes.
// Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "check-lists-secret";
process.env.ADMIN_EMAIL = "admin@hmc.com";
process.env.ADMIN_PASSWORD = "admin-pass-1";
process.env.WHATSAPP_PROVIDER = "none";

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_listscheck_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: doctorRouter } = await import("../routes/doctorRoute.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const { runMigrations } = await import("../config/migrations.js");
const { hospitalSlotDate, slotToDate } = await import("../utils/slots.js");

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
const get = async (path, headers) => (await fetch(base + path, { headers })).json();

// --- The screens' old browser-side logic (admin/src/pages/Admin/AllAppointments.jsx) ---
const compareSlotDates = (a, b) => {
  const key = (s) => {
    const [d, m, y] = String(s || "").split("_").map(Number);
    return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
  };
  return key(a) - key(b);
};
const appointmentTime = (a) => new Date(a.startAt || slotToDate(a.slotDate, a.slotTime)).getTime();
const isOpen = (item) => !item.cancelled && !item.isCompleted && item.status !== "no_show";
const oldScreen = (all, { range, docId, status, notify, q }) => {
  const today = hospitalSlotDate(new Date());
  const inRange = all.filter((item) => {
    const order = compareSlotDates(item.slotDate, today);
    return range === "all" || (range === "today" ? order === 0 : range === "upcoming" ? order > 0 : order < 0);
  });
  const term = (q || "").trim().toLowerCase();
  const list = inRange.filter((item) => {
    if (term) {
      const haystack = [item.userData?.name, item.docData?.name, item.userData?.phone, item.userData?.whatsappNumber].join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (docId && item.docId !== docId) return false;
    if (status === "cancelled" && !item.cancelled) return false;
    if (status === "completed" && !item.isCompleted) return false;
    if (status === "no_show" && item.status !== "no_show") return false;
    if (status === "pending" && !isOpen(item)) return false;
    if (notify === "whatsapp" && !item.userData?.whatsappEnabled) return false;
    if (notify === "email" && item.userData?.whatsappEnabled) return false;
    return true;
  });
  const direction = range === "today" || range === "upcoming" ? 1 : -1;
  const summary = { open: 0, completed: 0, noShow: 0, cancelled: 0 };
  for (const a of list) {
    if (a.cancelled) summary.cancelled++;
    else if (a.isCompleted) summary.completed++;
    else if (a.status === "no_show") summary.noShow++;
    else summary.open++;
  }
  return { list: list.sort((a, b) => direction * (appointmentTime(a) - appointmentTime(b))), summary };
};

// Every page of one query, following nextCursor
const pageAll = async (path, headers) => {
  const rows = [];
  let first = null;
  let cursor = "";
  for (let guard = 0; guard < 500; guard++) {
    const data = await get(path + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""), headers);
    if (!data.success) throw new Error(`${path}: ${data.message}`);
    first ??= data;
    rows.push(...data.appointments);
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return { rows, first };
};

// Same appointments, in a valid order (equal times may come in any order)
const sameList = (got, expected, ascending) => {
  const ids = (list) => list.map((a) => String(a._id)).sort().join(",");
  if (ids(got) !== ids(expected)) return false;
  for (let i = 1; i < got.length; i++) {
    const diff = appointmentTime(got[i]) - appointmentTime(got[i - 1]);
    if (ascending ? diff < 0 : diff > 0) return false;
  }
  return true;
};

try {
  // --- Data: 3 doctors, two weeks back to two weeks ahead, every status ---
  const doctors = await doctorModel.insertMany(
    ["Imran Shah", "Sana Malik", "Bilal Ahmed"].map((name, i) => ({
      name, email: `doc${i}@hmc.com`, password: "x", image: "i", speciality: "General physician",
      degree: "MBBS", experience: "5", about: "Long profile text. ".repeat(20), fee: 1000 + i * 500,
      address: { line1: "HMC" }, date: Date.now(), hospitalSharePercent: 30,
    }))
  );
  const names = ["Ayesha Khan", "Rashid Ali", "Fatima Noor", "Usman Tariq", "Zainab Bibi", "Hamza Iqbal"];
  const TIMES = ["09:00 AM", "10:30 AM", "12:00 PM", "02:30 PM", "05:00 PM"];
  const docs = [];
  let n = 0;
  for (let day = -14; day <= 14; day++) {
    for (let k = 0; k < 4; k++, n++) {
      const doctor = doctors[n % 3].toObject();
      const slotDate = hospitalSlotDate(new Date(), day);
      const slotTime = TIMES[(n + k) % TIMES.length];
      const status = day > 0 ? ["booked", "booked", "cancelled"][n % 3] : ["completed", "booked", "cancelled", "no_show", "completed"][n % 5];
      docs.push({
        userId: new mongoose.Types.ObjectId().toString(),
        docId: String(doctor._id),
        slotDate, slotTime,
        startAt: slotToDate(slotDate, slotTime),
        userData: {
          name: names[n % names.length], phone: `0300${String(1000000 + n)}`, whatsappNumber: n % 2 ? `0311${String(2000000 + n)}` : "",
          whatsappEnabled: n % 3 !== 0, password: "secret-hash", dob: "1990-01-01", image: "img",
        },
        docData: { ...doctor, password: "secret-hash" },
        amount: doctor.fee, date: Date.now(), status,
        cancelled: status === "cancelled", isCompleted: status === "completed",
        type: ["new", "follow_up", "walk_in"][n % 3],
        history: [{ at: new Date(), by: { role: "admin" }, action: "booked" }, ...(n % 4 === 0 ? [{ at: new Date(), by: { role: "admin" }, action: "checked_in", reason: "x" }] : [])],
        notifications: [{ at: new Date(), channel: "whatsapp", recipient: "patient", kind: "confirmation", status: "sent" }],
      });
    }
  }
  // An older appointment saved before startAt existed
  const legacySlot = hospitalSlotDate(new Date(), -20);
  docs.push({
    userId: "u-legacy", docId: String(doctors[0]._id), slotDate: legacySlot, slotTime: "11:00 AM",
    userData: { name: "Old Record Patient", phone: "03009999999" }, docData: { name: "Imran Shah" },
    amount: 1000, date: Date.now(), status: "completed", cancelled: false, isCompleted: true,
  });
  await appointmentModel.collection.insertMany(docs);
  await appointmentModel.syncIndexes();
  const parent = await appointmentModel.findOne({ isCompleted: true, docId: String(doctors[1]._id) }).lean();
  await appointmentModel.collection.insertOne({
    ...docs[0], _id: new mongoose.Types.ObjectId(), parentAppointmentId: String(parent._id),
    slotDate: hospitalSlotDate(new Date(), 15), slotTime: "11:00 AM", startAt: slotToDate(hospitalSlotDate(new Date(), 15), "11:00 AM"),
    docId: String(doctors[1]._id), status: "booked", cancelled: false, isCompleted: false, type: "follow_up",
  });

  // --- Migration: older appointments get startAt (once) ---
  await runMigrations();
  const legacy = await appointmentModel.findOne({ userId: "u-legacy" }).lean();
  check("Migration adds startAt to an older appointment", legacy.startAt?.getTime() === slotToDate(legacySlot, "11:00 AM").getTime());
  const marker = await mongoose.connection.collection("migrations").findOne({ _id: "appointment-startAt" });
  check("Migration records that it ran (no rescan on the next start)", marker?.updated === 1);
  await appointmentModel.collection.insertOne({ ...docs[0], _id: new mongoose.Types.ObjectId(), userId: "u-after", startAt: undefined });
  await appointmentModel.collection.updateOne({ userId: "u-after" }, { $unset: { startAt: 1 } });
  await runMigrations();
  check("Second start doesn't rescan", !(await appointmentModel.findOne({ userId: "u-after" }).lean()).startAt);
  await appointmentModel.deleteOne({ userId: "u-after" });

  const all = await appointmentModel.find({}).lean();
  const adminH = { atoken: jwt.sign({ role: "admin" }, process.env.JWT_SECRET) };
  const receptionH = { atoken: jwt.sign({ role: "reception" }, process.env.JWT_SECRET) };

  // --- Every filter combination matches the old screen (admin) ---
  let combos = 0;
  let mismatches = [];
  for (const range of ["today", "upcoming", "past", "all"]) {
    for (const docId of [undefined, String(doctors[1]._id)]) {
      for (const status of [undefined, "pending", "completed", "no_show", "cancelled"]) {
        for (const notify of [undefined, "whatsapp", "email"]) {
          for (const q of [undefined, "KHAN", "0311", "sana"]) {
            if (q && (status || notify)) continue; // keep the run short; search is checked with each range and doctor
            combos++;
            const params = new URLSearchParams({ range, limit: "7", ...(docId && { docId }), ...(status && { status }), ...(notify && { notify }), ...(q && { q }) });
            const { rows, first } = await pageAll(`/api/admin/appointments?${params}`, adminH);
            const expected = oldScreen(all, { range, docId, status, notify, q });
            const ascending = range === "today" || range === "upcoming";
            const ok =
              sameList(rows, expected.list, ascending) &&
              first.summary.total === expected.list.length &&
              ["open", "completed", "noShow", "cancelled"].every((k) => first.summary[k] === expected.summary[k]);
            if (!ok) mismatches.push(`${params} got ${rows.length} expected ${expected.list.length} summary ${JSON.stringify(first.summary)} vs ${JSON.stringify(expected.summary)}`);
          }
        }
      }
    }
  }
  check(`All ${combos} filter combinations give exactly what the screen showed before`, mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

  let data = await get("/api/admin/appointments?range=today", adminH);
  const counted = (range) => oldScreen(all, { range }).list.length;
  check(
    "Tab counts match (today / upcoming / past / all)",
    data.counts.today === counted("today") && data.counts.upcoming === counted("upcoming") && data.counts.past === counted("past") && data.counts.all === all.length,
    JSON.stringify(data.counts)
  );
  check("Reception sees the same paged list", (await get("/api/admin/appointments?range=today", receptionH)).appointments.length === data.appointments.length);
  check("Pages after the first don't recount", (await get(`/api/admin/appointments?range=all&limit=5&cursor=${encodeURIComponent((await get("/api/admin/appointments?range=all&limit=5", adminH)).nextCursor)}`, adminH)).counts === undefined);

  // Manage a Day: one doctor's day
  const dayDoc = String(doctors[0]._id);
  const tomorrow = hospitalSlotDate(new Date(), 1);
  data = await get(`/api/admin/appointments?day=${tomorrow}&docId=${dayDoc}&limit=200`, adminH);
  check("Manage a Day: one doctor's appointments on one day", sameList(data.appointments, all.filter((a) => a.slotDate === tomorrow && a.docId === dayDoc), false) && data.appointments.length > 0);

  // --- Small rows: what no screen reads is left out, what screens read is kept ---
  const row = (await get("/api/admin/appointments?range=all&limit=200", adminH)).appointments.find((a) => a.history?.length > 1);
  check("Rows leave out the notification log and passwords", row && !row.notifications && !row.userData.password && !row.docData.password && !row.docData.about);
  check("Rows keep what the screens read", row && ["name", "phone", "whatsappNumber", "whatsappEnabled", "dob", "image"].every((k) => k in row.userData) && row.docData.name && row.docData.fee && row.docData.speciality && row.history.some((h) => h.action === "checked_in") && !row.history[0].reason);
  const withFollowUp = (await pageAll(`/api/admin/appointments?range=past&docId=${doctors[1]._id}&limit=50`, adminH)).rows.find((a) => String(a._id) === String(parent._id));
  check("A visit shows the follow-up booked from it", withFollowUp?.followUp?.slotTime === "11:00 AM");

  // --- Doctor: only their own, same matching ---
  const docH = { dtoken: jwt.sign({ id: String(doctors[2]._id), role: "doctor" }, process.env.JWT_SECRET) };
  mismatches = [];
  for (const range of ["today", "upcoming", "past", "all"]) {
    for (const status of [undefined, "pending", "completed", "no_show", "cancelled"]) {
      const params = new URLSearchParams({ range, limit: "4", ...(status && { status }) });
      const { rows } = await pageAll(`/api/doctor/appointments?${params}`, docH);
      const expected = oldScreen(all, { range, status, docId: String(doctors[2]._id) }).list;
      if (!sameList(rows, expected, range === "today" || range === "upcoming")) mismatches.push(String(params));
    }
  }
  check("Doctor's paged list matches their old screen for every range and status", mismatches.length === 0, mismatches.join(" | "));
  const ownName = doctors[2].name.split(" ")[0];
  data = await get(`/api/doctor/appointments?range=all&q=${ownName}&limit=200`, docH);
  check("A doctor searching their own name finds no rows (patient fields only, as before)", data.success && data.appointments.length === 0, String(data.appointments?.length));
  data = await get(`/api/doctor/appointments?range=all&q=0311&limit=200`, docH);
  check("A doctor's search matches patient phone numbers", data.appointments.length > 0 && data.appointments.length === all.filter((a) => a.docId === String(doctors[2]._id) && /0311/.test(`${a.userData.name} ${a.userData.phone} ${a.userData.whatsappNumber}`)).length);
  data = await get(`/api/doctor/appointments?range=all&docId=${doctors[0]._id}&limit=200`, docH);
  check("A doctor can't page another doctor's appointments", data.appointments.every((a) => a.docId === String(doctors[2]._id)) && data.counts.all === all.filter((a) => a.docId === String(doctors[2]._id)).length);

  // --- Old screens (no range): unchanged list, every appointment ---
  data = await get("/api/admin/appointments", adminH);
  check("Without ?range the old response still lists every appointment", data.success && !data.paged && data.appointments.length === all.length);
  data = await get("/api/doctor/appointments", docH);
  check("Doctor's old response still lists all of theirs", data.appointments.length === all.filter((a) => a.docId === String(doctors[2]._id)).length);

  // --- Bad input is ignored, not an error ---
  data = await get("/api/admin/appointments?range=today&cursor=garbage&limit=99999&status=nope&docId=xyz", adminH);
  check("Bad cursor/limit/filters are ignored safely", data.success && data.appointments.length === counted("today"));
  data = await get("/api/admin/appointments?range=all&limit=500", adminH);
  check("Page size is capped at 200", data.appointments.length === Math.min(200, all.length));
  data = await get("/api/admin/appointments?range=all&q=" + encodeURIComponent("(.*)+$"), adminH);
  check("Search text is matched literally (no regex injection)", data.success && data.appointments.length === 0);

  // --- Queries use indexes (no full collection scan, no in-memory sort) ---
  // The plan MongoDB picked (rejected candidate plans may contain a SORT stage)
  const plan = async (filter, sort) =>
    JSON.stringify((await appointmentModel.find(filter).sort(sort).limit(51).explain("queryPlanner")).queryPlanner.winningPlan);
  const today0 = all.find((a) => a.slotDate === hospitalSlotDate(new Date())).startAt;
  const p1 = await plan({ startAt: { $gte: today0 } }, { startAt: 1, _id: 1 });
  const p2 = await plan({ docId: dayDoc, startAt: { $lt: today0 } }, { startAt: -1, _id: -1 });
  check("All-doctor list uses the startAt index", /IXSCAN/.test(p1) && !/COLLSCAN/.test(p1) && !/"stage":"SORT"/.test(p1));
  check("One-doctor list uses the docId+startAt index", /IXSCAN/.test(p2) && !/COLLSCAN/.test(p2) && !/"stage":"SORT"/.test(p2));
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL LIST CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
