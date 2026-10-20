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

  // --- Doctor dashboard numbers: computed in the database, same as the old loop ---
  // Extra completed visits: with and without a saved split, and amounts that hit .5
  // (JavaScript rounds .5 up; MongoDB's $round would round to even)
  const extra = [1015, 999.5, 2005, 1500, 333.5].map((amount, i) => ({
    ...docs[0], _id: new mongoose.Types.ObjectId(), docId: String(doctors[2]._id), userId: `extra-${i % 3}`,
    amount, status: "completed", isCompleted: true, cancelled: false,
    ...(i % 2 === 0 && { share: { percent: 20, hospital: Math.round(amount * 0.2), doctor: amount - Math.round(amount * 0.2) } }),
  }));
  await appointmentModel.collection.insertMany(extra);
  const { visitSplit } = await import("../services/profitService.js");
  const oldDashboard = (list, percent) => {
    let earnings = 0;
    let fees = 0;
    for (const item of list) {
      if (!item.isCompleted) continue;
      const split = visitSplit(item, percent);
      earnings += split.doctor;
      fees += split.hospital + split.doctor;
    }
    return {
      earnings, fees, appointments: list.length, patients: new Set(list.map((a) => a.userId)).size,
      noShow: list.filter((a) => a.status === "no_show").length,
      // The old unsorted find({ docId }) returned docId+startAt index order, reversed: latest time first
      latest: [...list].sort((a, b) => b.startAt - a.startAt || String(b._id).localeCompare(String(a._id))).slice(0, 5).map((a) => String(a._id)),
    };
  };
  for (const doctor of doctors) {
    const mine = await appointmentModel.find({ docId: String(doctor._id) }).lean();
    const expected = oldDashboard(mine, doctor.hospitalSharePercent);
    const dash = (await get("/api/doctor/dashboard", { dtoken: jwt.sign({ id: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET) })).dashData;
    const got = { earnings: dash.earnings, fees: dash.fees, appointments: dash.appointments, patients: dash.patients, noShow: dash.noShow, latest: dash.latestAppointments.map((a) => String(a._id)) };
    check(`Doctor dashboard numbers unchanged (${doctor.name})`, JSON.stringify(got) === JSON.stringify(expected), `${JSON.stringify(got)} vs ${JSON.stringify(expected)}`);
  }
  await appointmentModel.deleteMany({ _id: { $in: extra.map((e) => e._id) } });

  // --- Patients (Manage Patients): paged, same matching as the screen had ---
  const { default: userModel } = await import("../model/userModel.js");
  const first = ["Ayesha", "Rashid", "Fatima", "Usman", "Zainab", "Hamza", "Khan"];
  await userModel.collection.insertMany(
    Array.from({ length: 120 }, (_, i) => ({
      name: `${first[i % 7]} ${["Khan", "Ali", "Noor", "Tariq"][i % 4]} ${i}`,
      phone: `0300${String(4000000 + i)}`,
      ...(i % 5 === 0 && { email: `p${i}@Gmail.com` }),
      ...(i % 3 === 0 && { cnic: `4210${String(100000000 + i)}` }),
      gender: ["Male", "Female", "Other"][i % 3],
      ...(i % 7 !== 6 && { whatsappEnabled: i % 2 === 0 }), // some older records have no flag at all
      password: "hash",
      createdAt: new Date(),
    }))
  );
  const patientsAll = await userModel.find({}).sort({ _id: 1 }).lean();
  // admin/src/pages/Admin/ManagePatients.jsx filterPatients(), as it was
  const oldPatients = ({ q, gender, whatsapp }) =>
    patientsAll.filter((patient) => {
      if (q) {
        const term = q.toLowerCase();
        if (!(patient.name.toLowerCase().includes(term) || (patient.email || "").toLowerCase().includes(term) ||
          (patient.phone || "").toLowerCase().includes(term) || (patient.cnic && patient.cnic.includes(q)))) return false;
      }
      if (gender && gender !== "all" && patient.gender !== gender) return false;
      if (whatsapp && whatsapp !== "all" && patient.whatsappEnabled !== (whatsapp === "enabled")) return false;
      return true;
    });
  mismatches = [];
  let patientCombos = 0;
  for (const q of [undefined, "khan", "AYESHA", "4000", "4210", "gmail", "zzz"]) {
    for (const gender of [undefined, "Female"]) {
      for (const whatsapp of [undefined, "enabled", "disabled"]) {
        patientCombos++;
        const params = new URLSearchParams({ limit: "13", ...(q && { q }), ...(gender && { gender }), ...(whatsapp && { whatsapp }) });
        const got = [];
        let total = null;
        let cursor = "";
        for (let guard = 0; guard < 50; guard++) {
          const page = await get(`/api/admin/all-patients?${params}${cursor ? `&cursor=${cursor}` : ""}`, adminH);
          total ??= page.total;
          got.push(...page.patients);
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        const expected = oldPatients({ q, gender, whatsapp });
        const same = got.map((p) => String(p._id)).join() === expected.map((p) => String(p._id)).join() && total === expected.length;
        if (!same) mismatches.push(`${params}: got ${got.length}/${total}, expected ${expected.length}`);
      }
    }
  }
  check(`Patients: all ${patientCombos} search/filter combinations match the old screen (same order)`, mismatches.length === 0, mismatches.slice(0, 3).join(" | "));
  data = await get("/api/admin/all-patients?limit=500", receptionH);
  check("Patients: reception can page them too; page size capped at 200; no passwords", data.success && data.patients.length === 120 - 0 && data.patients.length <= 200 && data.patients.every((p) => !p.password), String(data.patients?.length));
  data = await get(`/api/admin/all-patients?limit=50&q=${encodeURIComponent("(.*)+$")}`, adminH);
  check("Patients: search text is matched literally (no regex injection)", data.success && data.patients.length === 0 && data.total === 0);
  data = await get(`/api/admin/all-patients?limit=50&cursor=nonsense&gender=Robot`, adminH);
  check("Patients: bad cursor and filters are ignored safely", data.success && data.total === patientsAll.length);
  // Old screens (no ?limit): every patient while there are at most 2000; beyond that
  // the 2000 most recent (still oldest first), so a stale tab can't pull an unbounded list
  data = await get("/api/admin/all-patients", adminH);
  check("Patients: without ?limit, all patients while under the cap (old order)", data.success && data.total === undefined &&
    data.patients.map((p) => String(p._id)).join() === patientsAll.map((p) => String(p._id)).join());
  const bulk = Array.from({ length: 2000 }, (_, i) => ({ name: `Bulk ${i}`, gender: "Male", createdAt: new Date() }));
  await userModel.collection.insertMany(bulk);
  data = await get("/api/admin/all-patients", adminH);
  const newest = (await userModel.find({}).sort({ _id: -1 }).limit(2000).lean()).reverse().map((p) => String(p._id));
  check("Patients: without ?limit, at most the 2000 most recent, oldest first", data.patients.length === 2000 && data.patients.map((p) => String(p._id)).join() === newest.join());
  await userModel.deleteMany({ name: /^Bulk / });

  // --- Old screens (no range): the last 90 days and everything upcoming ---
  // (bounded, so a tab still running the previous version can't pull years of data)
  const ancientDate = hospitalSlotDate(new Date(), -200);
  const ancient = { ...docs[0], _id: new mongoose.Types.ObjectId(), docId: String(doctors[2]._id), slotDate: ancientDate, startAt: slotToDate(ancientDate, "10:30 AM") };
  await appointmentModel.collection.insertOne(ancient);
  data = await get("/api/admin/appointments", adminH);
  const ids = (list) => list.map((a) => String(a._id)).sort().join();
  check("Without ?range: every appointment of the last 90 days and upcoming, nothing older", data.success && !data.paged &&
    ids(data.appointments) === ids(all) && !data.appointments.some((a) => String(a._id) === String(ancient._id)));
  data = await get("/api/doctor/appointments", docH);
  check("Doctor without ?range: theirs from the last 90 days and upcoming", ids(data.appointments) === ids(all.filter((a) => a.docId === String(doctors[2]._id))));
  data = await get("/api/admin/appointments?range=past&limit=200", adminH);
  check("The paged Past tab still reaches older appointments", data.appointments.some((a) => String(a._id) === String(ancient._id)));
  await appointmentModel.deleteOne({ _id: ancient._id });
  // A busy hospital: more than 2000 in the window -> the latest 2000 (about 2 MB)
  const busy = Array.from({ length: 2100 }, (_, i) => ({
    ...docs[0], _id: new mongoose.Types.ObjectId(), docId: String(doctors[2]._id), startAt: new Date(Date.now() - i * 60000),
  }));
  await appointmentModel.collection.insertMany(busy);
  data = await get("/api/admin/appointments", adminH);
  const cutoff = [...all.map((a) => a.startAt), ...busy.map((a) => a.startAt)].sort((a, b) => b - a)[1999];
  check("Without ?range: never more than 2000 rows, the latest ones", data.appointments.length === 2000 && data.appointments.every((a) => new Date(a.startAt) >= cutoff), String(data.appointments.length));
  await appointmentModel.deleteMany({ _id: { $in: busy.map((a) => a._id) } });

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
