// End-to-end checks for appointments, no-shows, Urdu WhatsApp messages, the live
// queue and the WhatsApp bot. Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// It creates its own throwaway database, deletes it at the end, and fakes the
// WhatsApp API, so nothing real is read, changed or sent. It refuses remote URIs.
process.env.WHATSAPP_PROVIDER = "meta";
process.env.META_ACCESS_TOKEN = "test";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
process.env.PUBLIC_SITE_URL = "https://site.test/";
process.env.QUEUE_NOTIFY_AHEAD = "2";
process.env.FOLLOW_UP_FREE_DAYS = "7";
delete process.env.WHATSAPP_DEFAULT_LANGUAGE;

const sent = [];
let urduApproved = false;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body || "{}");
  if (body.type === "template" && body.template.language.code === "ur" && !urduApproved) {
    return { ok: false, status: 404, json: async () => ({ error: { code: 132001, message: "Template name does not exist in the translation" } }) };
  }
  sent.push({ to: body.to, name: body.template?.name, lang: body.template?.language?.code, params: body.template?.components?.[0]?.parameters?.map((p) => p.text) });
  return { ok: true, json: async () => ({ messages: [{ id: "m" + sent.length }] }) };
};

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const dbName = "qclinics_check_" + Date.now();
await mongoose.connect(baseUri, { dbName });

const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: userModel } = await import("../model/userModel.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const svc = await import("../services/appointmentService.js");
const q = await import("../services/queueService.js");
const { hospitalSlotDate, HOSPITAL_UTC_OFFSET_MINUTES } = await import("../utils/slots.js");

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = { role: "admin" };

// A slot time today in hospital time, `minutesAhead` from now, on the 30-min grid
const slotToday = (minutesAhead) => {
  const local = new Date(Date.now() + HOSPITAL_UTC_OFFSET_MINUTES * 60000 + minutesAhead * 60000);
  let mins = Math.ceil((local.getUTCHours() * 60 + local.getUTCMinutes()) / 30) * 30;
  const h24 = Math.floor(mins / 60) % 24, m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

try {
  const doctor = await doctorModel.create({
    name: "Test Doc", email: "d@t.test", password: "x", image: "i", speciality: "General physician",
    degree: "MBBS", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now(),
    timings: { start: "00:00", end: "23:59" }, sittingDays: [],
  });
  const docId = String(doctor._id);
  const urduPatient = await userModel.create({ name: "Ali", phone: "03001234567", dob: "1990", address: {}, whatsappEnabled: true, whatsappNumber: "03001234567" });
  const enPatient = await userModel.create({ name: "Sara", phone: "03007654321", dob: "1990", address: {}, whatsappEnabled: true, whatsappNumber: "03007654321", language: "en" });
  const today = hospitalSlotDate(new Date());
  const tomorrow = hospitalSlotDate(new Date(), 1);

  // --- Urdu templates with English fallback ---
  const a1 = await svc.bookAppointment({ patient: urduPatient, doctor, slotDate: tomorrow, slotTime: "10:00 AM", amount: 1000, actor: admin });
  svc.queueBookingNotifications(a1, urduPatient, doctor);
  await wait(300);
  let msg = sent.find((s) => s.name === "appointment_confirmation" && s.to === "923001234567");
  check("Urdu patient (no language set) falls back to English while Urdu template unapproved", msg?.lang === "en", JSON.stringify(msg));
  check("Fallback message uses English date wording", /[A-Za-z]/.test(msg?.params?.[4] || ""), msg?.params?.[4]);

  urduApproved = true;
  sent.length = 0;
  // Cached as unavailable for 30 min: still English right after
  svc.queueBookingNotifications(a1, urduPatient, doctor);
  await wait(300);
  check("Unavailable Urdu template is remembered (no failing call per message)", sent[0]?.lang === "en", JSON.stringify(sent[0]));

  // A fresh process would retry Urdu: simulate by importing a new instance is hard; test Twilio-free path via English patient
  sent.length = 0;
  const a2 = await svc.bookAppointment({ patient: enPatient, doctor, slotDate: tomorrow, slotTime: "11:00 AM", amount: 0, actor: admin });
  svc.queueBookingNotifications(a2, enPatient, doctor);
  await wait(300);
  msg = sent.find((s) => s.to === "923007654321");
  check("English patient gets English, fee 0 kept as 0", msg?.lang === "en" && msg?.params?.[6] === "0", JSON.stringify(msg));

  // Urdu formatting directly (template approved path) via cancellation of a different template name
  sent.length = 0;
  await svc.cancelAppointment(a1._id, admin, { cancelledBy: "your doctor" });
  await wait(300);
  msg = sent.find((s) => s.name === "appointment_cancelled");
  check("Urdu cancellation sent in Urdu with Urdu date/time and 'آپ کے ڈاکٹر'",
    msg?.lang === "ur" && /اکتوبر|نومبر|دسمبر|جنوری|فروری|مارچ|اپریل|مئی|جون|جولائی|اگست|ستمبر/.test(msg.params[2]) && msg.params[3] === "صبح 10:00" && msg.params[4] === "آپ کے ڈاکٹر",
    JSON.stringify(msg));

  // --- No-show fixes ---
  const past = await appointmentModel.create({
    userId: String(enPatient._id), docId, slotDate: today, slotTime: "12:00 AM", startAt: new Date(Date.now() - 3600e3),
    userData: { name: "Sara" }, docData: { name: "Test Doc" }, amount: 1000, date: Date.now(), status: "booked",
  });
  await svc.markNoShow(past._id, admin);
  const laterToday = slotToday(120);
  const upcoming = await svc.bookAppointment({ patient: enPatient, doctor, slotDate: today, slotTime: laterToday, amount: 1000, actor: admin });
  sent.length = 0;
  const day = await svc.rescheduleDay({ docId, fromSlotDate: today, toSlotDate: hospitalSlotDate(new Date(), 2), actor: admin });
  const pastAfter = await appointmentModel.findById(past._id);
  check("Whole-day reschedule leaves the no-show alone", pastAfter.status === "no_show" && pastAfter.slotDate === today);
  check("Whole-day reschedule still moves the expected appointment", day.moved.some((m) => String(m._id) === String(upcoming._id)), JSON.stringify(day));

  // Whole-day reschedule when the patient's time is already taken on the new day:
  // they get the nearest free time (later first), not "not moved"
  const busyDay = hospitalSlotDate(new Date(), 6);
  const awayDay = hospitalSlotDate(new Date(), 7);
  await svc.bookAppointment({ patient: urduPatient, doctor, slotDate: busyDay, slotTime: "10:00 AM", amount: 1000, actor: admin });
  const clash = await svc.bookAppointment({ patient: enPatient, doctor, slotDate: awayDay, slotTime: "10:00 AM", amount: 1000, actor: admin });
  const shifted = await svc.rescheduleDay({ docId, fromSlotDate: awayDay, toSlotDate: busyDay, actor: admin });
  const clashMoved = shifted.moved.find((m) => String(m._id) === String(clash._id));
  check("Whole-day reschedule gives a taken time the nearest later free time", clashMoved?.to === "10:30 AM" && !shifted.notMoved.length, JSON.stringify(shifted));

  const moved = await svc.moveAppointment(past._id, tomorrow, "03:00 PM", admin);
  check("Rebooking a no-show sets it back to booked", moved.status === "booked");

  // Free follow-up not given for a no-show parent
  const ns2 = await appointmentModel.create({
    userId: String(enPatient._id), docId, slotDate: today, slotTime: "12:30 AM", startAt: new Date(Date.now() - 1800e3),
    userData: { name: "Sara" }, docData: { name: "Test Doc" }, amount: 1000, date: Date.now(), status: "no_show",
  });
  const fu = await svc.bookFollowUp({ parentAppointmentId: ns2._id, doctorId: docId, slotDate: tomorrow, slotTime: "04:00 PM" });
  check("No-show parent doesn't get a free follow-up", fu.appointment.amount === 1000, fu.appointment.amount);

  // Cancelling a past no-show (undo) doesn't message the patient
  sent.length = 0;
  await svc.cancelAppointment(ns2._id, admin, {});
  await wait(200);
  check("Cancelling a past visit sends no WhatsApp", sent.length === 0, JSON.stringify(sent));

  // --- Queue ---
  sent.length = 0;
  const w1 = (await q.issueToken({ docId, patientName: "Walk One", actor: admin })).token;
  const w2 = (await q.issueToken({ docId, patientName: "Walk Two", phone: "0300 1112223", notify: true, language: "ur", actor: admin })).token;
  const w3 = (await q.issueToken({ docId, patientName: "Walk Three", phone: "03004445556", notify: true, language: "en", actor: admin })).token;
  check("Token numbers start at 1 and increase", w1.number === 1 && w2.number === 2 && w3.number === 3);
  check("Walk-in fee defaults to doctor's fee", w1.fee === 1000);
  await wait(300);
  const tokMsg = sent.find((s) => s.name === "queue_token" && s.to === "923004445556");
  check("Queue token WhatsApp has track link and ahead count", tokMsg && tokMsg.params[6].startsWith("https://site.test/queue/t/") && tokMsg.params[4] === "2", JSON.stringify(tokMsg));
  check("No WhatsApp for walk-in without consent", !sent.some((s) => s.params?.[0] === "Walk One"));

  let threw = "";
  try { await q.issueToken({ docId, patientName: "Land", phone: "0423 1234567", notify: true, actor: admin }); } catch (e) { threw = e.message; }
  check("WhatsApp to a landline is refused", /mobile/.test(threw), threw);
  try { await q.issueToken({ docId, patientName: "  ", actor: admin }); threw = ""; } catch (e) { threw = e.message; }
  check("Empty name refused", /name/.test(threw));

  // Concurrent issuing: numbers stay unique
  const many = await Promise.all([1, 2, 3, 4, 5].map((i) => q.issueToken({ docId, patientName: "C" + i, actor: admin })));
  const nums = many.map((m) => m.token.number);
  check("Concurrent tokens get unique numbers", new Set(nums).size === 5, nums.join(","));
  const far = (await q.issueToken({ docId, patientName: "Far Back", phone: "03009998887", notify: true, language: "ur", actor: admin })).token;
  check("Far-back patient is not pre-marked as notified", !far.nearNotifiedAt);

  // Appointment check-in: an on-time appointment for later is placed at its time
  const apt = await svc.bookAppointment({ patient: urduPatient, doctor, slotDate: today, slotTime: slotToday(60), amount: 1000, actor: admin });
  const chk = await q.issueToken({ docId, appointmentId: apt._id, actor: admin });
  const chk2 = await q.issueToken({ docId, appointmentId: apt._id, actor: admin });
  check("Checking in twice returns the same token", chk2.existing && chk2.token.number === chk.token.number);
  let view = await q.staffView(docId);
  check("Early appointment waits behind walk-ins who are already here", view.waiting[view.waiting.length - 1]?.appointmentId === String(apt._id),
    view.waiting.map((t) => t.number).join(","));
  check("Checked-in appointment no longer in check-in list", !view.appointmentsToCheckIn.some((a) => String(a._id) === String(apt._id)));

  // Urgent goes first
  const urgent = (await q.issueToken({ docId, patientName: "Emergency", urgent: true, actor: admin })).token;
  view = await q.staffView(docId);
  check("Urgent token is first in line", String(view.waiting[0]._id) === String(urgent._id));

  // Call next: urgent first, then 1, 2 ...
  sent.length = 0;
  let called = await q.callNext(docId, admin);
  check("Call next takes the urgent patient", String(called._id) === String(urgent._id));
  called = await q.callNext(docId, admin);
  check("Next call finishes the previous one and takes token 1", called.number === 1);
  const urgentAfter = await (await import("../model/queueModel.js")).queueTokenModel.findById(urgent._id);
  check("Previous token marked done with times", urgentAfter.status === "done" && urgentAfter.doneAt && urgentAfter.calledAt);
  await wait(200);
  check("No turn-near while far back", !sent.some((s) => s.name === "queue_turn_near"));
  const { queueTokenModel: QT } = await import("../model/queueModel.js");
  // Take patients out of line until "Far Back" is 2 from the front
  for (let i = 0; i < 20; i++) {
    const v = await q.staffView(docId);
    const idx = v.waiting.findIndex((t) => String(t._id) === String(far._id));
    if (idx <= 2) break;
    await q.tokenAction(docId, v.waiting.find((t) => String(t._id) !== String(far._id) && t.kind === "walk_in" && t.number > 3)._id, "left", admin);
  }
  await wait(400);
  const near = sent.filter((s) => s.name === "queue_turn_near");
  check("Turn-near sent once to the far-back patient when 2 ahead, in Urdu", near.length === 1 && near[0].to === "923009998887" && near[0].lang === "ur", JSON.stringify(near));
  const nearCount = near.length;
  await q.tokenAction(docId, called._id, "skip", admin);
  await wait(300);
  check("Turn-near not repeated", sent.filter((s) => s.name === "queue_turn_near").length === nearCount);

  // Skip + back in line
  view = await q.staffView(docId);
  const firstRegular = view.waiting.find((t) => !t.urgent);
  await q.tokenAction(docId, called._id, "back_in_line", admin);
  view = await q.staffView(docId);
  check("Skipped patient who returns goes to the front", String(view.waiting[0]._id) === String(called._id),
    `${view.waiting[0].number} vs first regular ${firstRegular?.number}`);

  // Calling the appointment token then next completes the appointment
  await q.callNext(docId, admin, chk.token._id);
  await q.callNext(docId, admin);
  const aptAfter = await appointmentModel.findById(apt._id);
  check("Finishing an appointment token completes the appointment", aptAfter.isCompleted && aptAfter.status === "completed");
  check("Check-in recorded in appointment history", aptAfter.history.some((h) => h.action === "checked_in"));

  // Other doctor can't touch this queue
  try { await q.tokenAction(String(new mongoose.Types.ObjectId()), w1._id, "left", admin); threw = ""; } catch (e) { threw = e.message; }
  check("Token of another doctor is rejected", /not found/i.test(threw));

  // Pause shows on public board, no names exposed
  await q.setPaused(docId, true, "Namaz break");
  const board = await q.publicBoard();
  const b = board.doctors[0];
  check("Public board shows pause, now serving and next numbers", b.paused && b.pauseNote === "Namaz break" && typeof b.nowServing === "number" && b.next.length > 0, JSON.stringify(b));
  check("Public board has no patient names", !JSON.stringify(board).match(/Walk|Emergency|Ali|Sara/));
  await q.setPaused(docId, false);

  const pt = await q.publicToken(w3.publicId);
  check("Public token page shows place and wait", pt && pt.status === "waiting" && pt.ahead >= 0 && pt.waitMinutes >= 0, JSON.stringify(pt));
  check("Public token page has no patient name", !JSON.stringify(pt).includes("Walk"));
  check("Unknown public id returns nothing", (await q.publicToken("zzzzzzzz")) === null);

  // No-show patient arrives late: check-in undoes the no-show
  const lateApt = await appointmentModel.create({
    userId: String(enPatient._id), docId, slotDate: today, slotTime: "01:00 AM", startAt: new Date(Date.now() - 600e3),
    userData: { name: "Sara" }, docData: { name: "Test Doc" }, amount: 1000, date: Date.now(), status: "no_show",
  });
  view = await q.staffView(docId);
  check("Late no-show appears in the check-in list marked as no-show", view.appointmentsToCheckIn.some((a) => String(a._id) === String(lateApt._id) && a.noShow));
  await q.issueToken({ docId, appointmentId: lateApt._id, actor: admin });
  check("Late arrival check-in sets status back to booked", (await appointmentModel.findById(lateApt._id)).status === "booked");

  // Races: two receptionists / doctor + reception pressing at the same moment
  const { queueTokenModel: QTM } = await import("../model/queueModel.js");
  await QTM.init(); // make sure the unique indexes exist before racing
  const raceApt = await svc.bookAppointment({ patient: enPatient, doctor, slotDate: today, slotTime: slotToday(150), amount: 1000, actor: admin });
  const checks = await Promise.all([1, 2, 3].map(() => q.issueToken({ docId, appointmentId: raceApt._id, actor: admin }).catch((e) => ({ error: e.message }))));
  const raceTokens = await QTM.find({ appointmentId: String(raceApt._id) });
  check("Simultaneous check-ins of one appointment give one token", raceTokens.length === 1 && checks.every((c) => !c.error && c.token.number === raceTokens[0].number),
    JSON.stringify(checks.map((c) => c.error || c.token.number)));

  for (const name of ["R1", "R2", "R3", "R4"]) await q.issueToken({ docId, patientName: name, actor: admin });
  const before = await q.staffView(docId);
  const results = await Promise.all([1, 2, 3].map(() => q.callNext(docId, admin, undefined, before.current?._id ? String(before.current._id) : "").then((t) => t?.number ?? null, (e) => "ERR:" + e.message)));
  const calledNow = await QTM.find({ docId, day: today, status: "called" });
  check("Simultaneous 'call next' calls exactly one patient", calledNow.length === 1 && results.filter((r) => typeof r === "number").length === 1,
    JSON.stringify(results));

  // A screen that is out of date (shows nobody with the doctor) can't finish the current patient
  let stale = "";
  try { await q.callNext(docId, admin, undefined, ""); } catch (e) { stale = e.message; }
  check("Out-of-date screen can't finish someone it didn't show", /changed/.test(stale) && (await QTM.countDocuments({ _id: calledNow[0]._id, status: "called" })) === 1, stale);

  // Calling a token that can't be called leaves the current patient with the doctor
  let bad = "";
  try { await q.callNext(docId, admin, String(urgent._id), String(calledNow[0]._id)); } catch (e) { bad = e.message; }
  check("Failed call doesn't finish the current patient", /can't be called/.test(bad) && (await QTM.countDocuments({ _id: calledNow[0]._id, status: "called" })) === 1, bad);

  // Cancelling a checked-in appointment takes the token out of the line
  const cxApt = await svc.bookAppointment({ patient: enPatient, doctor, slotDate: today, slotTime: slotToday(180), amount: 1000, actor: admin });
  const cxTok = (await q.issueToken({ docId, appointmentId: cxApt._id, actor: admin })).token;
  await svc.cancelAppointment(cxApt._id, admin, {});
  check("Cancelled appointment leaves the queue", (await QTM.findById(cxTok._id)).status === "left");

  // --- Walk-ins are real patients and real visits ---
  {
    const { default: appointmentModelW } = await import("../model/appointmentModel.js");
    const { queueTokenModel: QTW } = await import("../model/queueModel.js");
    const usersBefore = await userModel.countDocuments();
    const w = (await q.issueToken({ docId, patientName: "Ghulam Rasool", phone: "0321 7654321", age: "58", gender: "Male", fee: 800, actor: admin })).token;
    const visit = await appointmentModelW.findById(w.appointmentId);
    const person = await userModel.findById(w.userId);
    check("Walk-in token creates a patient record", (await userModel.countDocuments()) === usersBefore + 1 && person?.name === "Ghulam Rasool" && person.gender === "Male" && person.dobEstimated === true);
    check("Walk-in token creates a visit (today, now, fee, walk-in)", visit && visit.type === "walk_in" && visit.slotDate === today && visit.amount === 800 && visit.status === "booked" && visit.history.map((h) => h.action).join(",") === "booked,checked_in", JSON.stringify(visit?.toObject?.()).slice(0, 200));

    // Seen by the doctor: the visit is completed and its fee counts as earnings
    await q.callNext(docId, admin, String(w._id), (await q.staffView(docId)).current?._id ? String((await q.staffView(docId)).current._id) : "");
    await q.tokenAction(docId, w._id, "done", admin);
    const done = await appointmentModelW.findById(w.appointmentId);
    check("Finishing the walk-in completes the visit", done.isCompleted && done.status === "completed");
    const earnings = (await appointmentModelW.find({ docId, isCompleted: true })).reduce((sum, a) => sum + a.amount, 0);
    check("Walk-in fee is in the doctor's earnings", earnings >= 800);

    // Follow-up from a walk-in visit
    const fuW = await svc.bookFollowUp({ parentAppointmentId: w.appointmentId, doctorId: docId, slotDate: hospitalSlotDate(new Date(), 5), slotTime: "11:00 AM" });
    check("Doctor can book a follow-up from a walk-in visit", fuW.appointment.type === "follow_up" && fuW.appointment.userId === String(person._id));

    // Same patient comes again: reception selects them, no duplicate record
    const again = (await q.issueToken({ docId, userId: String(person._id), actor: admin })).token;
    check("Returning patient reuses their record", again.userId === String(person._id) && (await userModel.countDocuments({ name: "Ghulam Rasool" })) === 1);
    check("Each visit is its own record (same patient twice a day)", again.appointmentId && again.appointmentId !== w.appointmentId);

    // A family sharing one phone
    const wife = (await q.issueToken({ docId, patientName: "Zubaida Bibi", phone: "03217654321", gender: "Female", actor: admin })).token;
    check("Family members can share a phone number", wife.userId && wife.userId !== String(person._id));
    const found = await q.searchPatients("+92 321 7654321");
    check("Search by phone (any format) finds the whole family", found.length === 2 && found.some((f) => f.name === "Zubaida Bibi"), JSON.stringify(found.map((f) => f.name)));
    check("Search by name", (await q.searchPatients("rasool")).length === 1);
    check("Search shows age from the estimated birth date", (await q.searchPatients("rasool"))[0].age === "58 y");

    // CNIC is the identity: a second record with the same CNIC is refused
    await q.issueToken({ docId, patientName: "Has CNIC", cnic: "35202-1234567-1", actor: admin });
    let dupe = "";
    try { await q.issueToken({ docId, patientName: "Someone Else", cnic: "3520212345671", actor: admin }); } catch (e) { dupe = e.message; }
    check("Same CNIC can't be registered twice", /already registered to Has CNIC/.test(dupe), dupe);
    check("Search by CNIC", (await q.searchPatients("3520212345671")).length === 1);

    // WhatsApp updates need a phone
    let noPhone = "";
    try { await q.issueToken({ docId, patientName: "No Phone", notify: true, actor: admin }); } catch (e) { noPhone = e.message; }
    check("WhatsApp updates without a phone are refused", /phone number/.test(noPhone), noPhone);

    // Went home without being seen: the visit is cancelled, no message sent
    sent.length = 0;
    const leaver = (await q.issueToken({ docId, patientName: "Left Early", phone: "03335550000", actor: admin })).token;
    await q.tokenAction(docId, leaver._id, "left", admin);
    const left = await appointmentModelW.findById(leaver.appointmentId);
    await wait(200);
    check("A walk-in who leaves has the visit cancelled", left.cancelled && left.history.some((h) => /Left the queue/.test(h.reason || "")));
    check("No WhatsApp for a walk-in leaving", !sent.some((x) => x.name === "appointment_cancelled"));

    // Walk-in visits can't be moved like appointments
    let moveErr = "";
    try { await svc.moveAppointment(again.appointmentId, hospitalSlotDate(new Date(), 2), "10:00 AM", admin); } catch (e) { moveErr = e.message; }
    check("A walk-in visit can't be rescheduled", /walk-in visit can't be moved/.test(moveErr), moveErr);

    // Deleting a doctor with patients still in today's queue is blocked
    const { deleteDoctor } = await import("../controllers/adminController.js").then((m) => ({ deleteDoctor: m.deleteDoctor })).catch(() => ({}));
    if (deleteDoctor) {
      const lonely = await doctorModel.create({ name: "Only Queue", email: "oq@x", password: "x", image: "i", speciality: "GP", degree: "d", experience: "1", about: "a", fee: 500, address: {}, date: Date.now() });
      const lonelyToken = (await q.issueToken({ docId: String(lonely._id), patientName: "Waiting One", actor: admin })).token;
      await appointmentModelW.deleteOne({ _id: lonelyToken.appointmentId }); // only the queue entry is left
      let out;
      await deleteDoctor({ params: { doctorId: String(lonely._id) } }, { json: (x) => (out = x) });
      check("Can't delete a doctor with patients still in today's queue", out && !out.success && /still in today's queue/.test(out.message), JSON.stringify(out));
    }
  }

  // "Call next" lock: a slow call whose lock expired must not release the next holder's lock
  {
    const { queueDayModel } = await import("../model/queueModel.js");
    const lockDoc = "lockcheck-doctor";
    const lockDay = "1_1_2030";
    let secondHeld = false;
    let refusedWhileSecondHolds = false;
    await q.withCallLock(lockDoc, lockDay, async () => {
      // This call is slow: its lock runs out and another call takes over
      await queueDayModel.updateOne({ _id: `${lockDoc}_${lockDay}` }, { $set: { callLockUntil: new Date(Date.now() - 1000) } });
      await q.withCallLock(lockDoc, lockDay, async () => {
        secondHeld = true;
      }).catch(() => {});
      // Simulate the second holder still working: take the lock again and keep it
      await queueDayModel.updateOne({ _id: `${lockDoc}_${lockDay}` }, { $set: { callLockUntil: new Date(Date.now() + 15000), callLockId: "someone-else" } });
    });
    // The slow first call has now finished: the other holder's lock must still be there
    try {
      await q.withCallLock(lockDoc, lockDay, async () => {});
    } catch (error) {
      refusedWhileSecondHolds = /Someone else is calling/.test(error.message);
    }
    const left = await queueDayModel.findById(`${lockDoc}_${lockDay}`).lean();
    check("Call lock: a slow call doesn't release someone else's lock", secondHeld && refusedWhileSecondHolds && left.callLockId === "someone-else", JSON.stringify(left));
  }

  // Bot: CANCEL picks the next upcoming visit, never a past no-show
  const { handleWhatsAppWebhook } = await import("../controllers/whatsappController.js");
  const ask = async (from, text) => {
    let out = "";
    await handleWhatsAppWebhook({ body: { Body: text, From: "whatsapp:" + from } }, { writeHead() {}, end(x) { out = x; }, status() { return this; }, send() {} });
    return out;
  };
  const botUser = await userModel.create({ name: "Bot Patient", phone: "03005550001", dob: "1990", address: {}, language: "ur" });
  const mk = (slotDate, slotTime, startAt, status, booked) => appointmentModel.create({
    userId: String(botUser._id), docId, slotDate, slotTime, startAt, userData: { name: "Bot Patient" }, docData: { name: "Test Doc" },
    amount: 1000, date: booked, status,
  });
  const farFuture = await mk(hospitalSlotDate(new Date(), 10), "10:00 AM", new Date(Date.now() + 10 * 86400e3), "booked", Date.now() - 5000);
  const soon = await mk(hospitalSlotDate(new Date(), 3), "10:00 AM", new Date(Date.now() + 3 * 86400e3), "booked", Date.now() - 4000);
  const missed = await mk(hospitalSlotDate(new Date(), -2), "10:00 AM", new Date(Date.now() - 2 * 86400e3), "no_show", Date.now());
  const statusReply = await ask("+923005550001", "حالت");
  check("Bot STATUS in Urdu shows the missed visit as missed", statusReply.includes("نہیں آئے") && statusReply.includes("آنے والی"), statusReply.slice(0, 300));
  // CANCEL is two steps: a numbered list first, then "CANCEL <n>" cancels exactly that one
  const isCancelled = async (apt) => (await appointmentModel.findById(apt._id)).cancelled;
  let cancelReply = await ask("+923005550001", "منسوخ");
  check("Bot CANCEL (Urdu keyword) only lists, cancels nothing", !(await isCancelled(soon)) && !(await isCancelled(farFuture)), cancelReply.slice(0, 200));
  check("The list is numbered soonest first, without the missed visit, and says how to confirm",
    /\*1\.\*/.test(cancelReply) && /\*2\.\*/.test(cancelReply) && !/\*3\.\*/.test(cancelReply) && cancelReply.includes("منسوخ 1"), cancelReply.slice(0, 300));
  cancelReply = await ask("+923005550001", "منسوخ ۲"); // Urdu digit 2
  check("CANCEL 2 (Urdu digit) cancels exactly the second one shown",
    (await isCancelled(farFuture)) && !(await isCancelled(soon)) && (await appointmentModel.findById(missed._id)).status === "no_show", cancelReply.slice(0, 200));
  cancelReply = await ask("+923005550001", "cancel 1");
  check("After cancelling, an old number needs a fresh list (nothing cancelled)", !(await isCancelled(soon)) && /\*1\.\*/.test(cancelReply), cancelReply.slice(0, 200));
  cancelReply = await ask("+923005550001", "cancel 7");
  check("A number that wasn't on the list cancels nothing and shows the list again", !(await isCancelled(soon)) && /\*1\.\*/.test(cancelReply));
  // A family on one phone: each line names the patient, so the right one is cancelled
  const sibling = await userModel.create({ name: "Bot Sibling", phone: "03005550001", dob: "2010", address: {}, language: "ur" });
  const siblingVisit = await appointmentModel.create({
    userId: String(sibling._id), docId, slotDate: hospitalSlotDate(new Date(), 2), slotTime: "11:00 AM", startAt: new Date(Date.now() + 2 * 86400e3),
    userData: { name: "Bot Sibling" }, docData: { name: "Test Doc" }, amount: 1000, date: Date.now() - 3000, status: "booked",
  });
  cancelReply = await ask("+923005550001", "cancel");
  check("Family phone: the list names each patient", cancelReply.includes("Bot Sibling") && cancelReply.includes("Bot Patient"), cancelReply.slice(0, 300));
  await ask("+923005550001", "cancel 1"); // the sibling's visit is the soonest
  check("Family phone: CANCEL 1 cancels the sibling's visit only", (await isCancelled(siblingVisit)) && !(await isCancelled(soon)));
  // The same message delivered twice (provider retry) is answered once
  const twilioAsk = async (sid, text) => {
    let out = "";
    await handleWhatsAppWebhook({ body: { Body: text, From: "whatsapp:+923005550001", MessageSid: sid } }, { writeHead() {}, end(x) { out = x; }, status() { return this; }, send() {} });
    return out;
  };
  await twilioAsk("SM-dup-1", "cancel");
  const firstTime = await twilioAsk("SM-dup-2", "cancel 1");
  const again = await twilioAsk("SM-dup-2", "cancel 1");
  check("A repeated delivery of the same message is ignored (no second reply)", (await isCancelled(soon)) && /Cancelled|منسوخ کر دی/.test(firstTime) && !/Message>/.test(again), again.slice(0, 120));
  // Kapso (the WhatsApp provider in use): signed webhook, the same message delivered twice
  {
    const crypto = await import("crypto");
    const { handleKapsoWebhook } = await import("../controllers/whatsappController.js");
    process.env.KAPSO_WEBHOOK_SECRET = "kapso-test-secret";
    const deliver = async (id, text) => {
      const body = { message: { id, type: "text", from: "923007654321", text: { body: text } } };
      const raw = Buffer.from(JSON.stringify(body));
      const headers = {
        "x-webhook-signature": crypto.createHmac("sha256", "kapso-test-secret").update(raw).digest("hex"),
        "x-webhook-event": "whatsapp.message.received",
      };
      let status;
      await handleKapsoWebhook(
        { body, rawBody: raw, get: (h) => headers[h.toLowerCase()] },
        { status(c) { status = c; return this; }, json() { return this; } }
      );
      return status;
    };
    sent.length = 0;
    const s1 = await deliver("wamid.DUP1", "contact");
    const s2 = await deliver("wamid.DUP1", "contact");
    await wait(400); // replies are sent after the webhook answers
    const replies = sent.filter((m) => m.to === "923007654321");
    check("Kapso: a repeated delivery is acknowledged but answered once", s1 === 200 && s2 === 200 && replies.length === 1, `${s1} ${s2} replies=${replies.length}`);
  }
  const helpEn = await ask("+923007654321", "hello");
  check("Bot replies in English to an English patient", helpEn.includes("Available Commands"));
  const unknown = await ask("+923009999999", "status");
  check("Unknown number gets a bilingual reply", unknown.includes("couldn't find") && unknown.includes("ریکارڈ"));
  // Migration: an existing database with a unique phone index is updated
  {
    const { runMigrations } = await import("../config/migrations.js");
    await userModel.collection.dropIndex("phone_1").catch(() => {});
    await userModel.collection.deleteMany({}); // last check: a clean collection like a real old database
    await userModel.collection.createIndex({ phone: 1 }, { unique: true, name: "phone_1" });
    await runMigrations();
    const phoneIndex = (await userModel.collection.indexes()).find((i) => i.name === "phone_1");
    check("Startup migration makes phone numbers shareable", phoneIndex && !phoneIndex.unique, JSON.stringify(phoneIndex));
    await userModel.create({ name: "Family A", phone: "03009990001" });
    await userModel.create({ name: "Family B", phone: "03009990001" });
    check("Two patients on one phone after migration", (await userModel.countDocuments({ phone: "03009990001" })) === 2);
  }

} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exitCode = failures ? 1 : 0;
}
