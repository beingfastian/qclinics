// End-to-end checks for the lab module through the real HTTP routes: logins and
// who may see/do what, ordering, live alerts, report upload/download, review.
// Run with: npm run check:integration (runs after checkIntegration.mjs)
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and a temp folder for report files, deletes both
// at the end, and sends nothing. It refuses remote database URIs.
import os from "os";
import fs from "fs";
import path from "path";

process.env.JWT_SECRET = process.env.JWT_SECRET || "check-lab-secret";
process.env.REPORT_STORAGE = "local";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-check-"));
process.env.REPORT_LOCAL_DIR = tmp;
process.env.WHATSAPP_PROVIDER = "none";
delete process.env.LAB_ENABLED;

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_labcheck_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { default: labRouter } = await import("../routes/labRoute.js");
const { default: queueRouter } = await import("../routes/queueRoute.js");
const { default: notificationRoutes } = await import("../routes/notificationRoutes.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: userModel } = await import("../model/userModel.js");
const { default: notificationModel } = await import("../model/notificationModel.js");
const svc = await import("../services/appointmentService.js");
const q = await import("../services/queueService.js");
const { labOrderModel } = await import("../model/labModel.js");
const { hospitalSlotDate } = await import("../utils/slots.js");

// Real app pieces on a random port; socket pushes are recorded instead of sent
const pushed = [];
const app = express();
app.use(express.json());
app.set("io", { to: (room) => ({ emit: (event, data) => pushed.push({ room, event, type: data?.type }) }) });
app.use("/api/lab", labRouter);
app.use("/api/queue", queueRouter);
app.use("/api/notifications", notificationRoutes);
app.use((err, req, res, next) => res.status(err.status || 400).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const call = async (method, url, { token, body, form } = {}) => {
  const headers = { ...(token || {}) };
  let payload;
  if (form) payload = form;
  else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + url, { method, headers, body: payload });
  const type = response.headers.get("content-type") || "";
  return { status: response.status, data: type.includes("json") ? await response.json() : await response.text(), headers: response.headers };
};

try {
  const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1h" });
  const admin = { atoken: sign({ role: "admin" }) };
  const docA = await doctorModel.create({ name: "Amina", email: "a@x", password: "x", image: "i", speciality: "Medicine", degree: "d", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now(), timings: { start: "00:00", end: "23:59" } });
  const docB = await doctorModel.create({ name: "Bilal", email: "b@x", password: "x", image: "i", speciality: "Surgery", degree: "d", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now(), timings: { start: "00:00", end: "23:59" } });
  const doctorA = { dtoken: sign({ role: "doctor", id: String(docA._id) }) };
  const doctorB = { dtoken: sign({ role: "doctor", id: String(docB._id) }) };
  const patient = await userModel.create({ name: "Rehana", phone: "03001234567", dob: "1970-05-01", gender: "Female", address: { line1: "Mohalla Islampura" }, cnic: "3520112345671" });

  // --- Lab accounts ---
  let r = await call("POST", "/api/lab/staff", { token: admin, body: { name: "Kashif", email: "Lab@Hospital.pk", password: "short" } });
  check("Lab account needs a password of 8+ characters", !r.data.success);
  r = await call("POST", "/api/lab/staff", { token: admin, body: { name: "Kashif", email: "Lab@Hospital.pk", password: "lab-pass-123", phone: "03110000000" } });
  check("Admin creates a lab account", r.data.success && !("password" in r.data.staff), JSON.stringify(r.data));
  const staffId = r.data.staff._id;
  r = await call("POST", "/api/lab/staff", { token: doctorA, body: { name: "X", email: "x@x.pk", password: "12345678" } });
  check("A doctor can't create lab accounts", r.status === 401 || r.data.success === false);

  r = await call("POST", "/api/lab/login", { body: { email: "lab@hospital.pk", password: "wrong-pass" } });
  check("Wrong lab password refused", !r.data.success);
  r = await call("POST", "/api/lab/login", { body: { email: "LAB@hospital.pk", password: "lab-pass-123" } });
  check("Lab staff log in (email not case-sensitive)", r.data.success && r.data.token);
  const labUser = { ltoken: r.data.token };

  // Lab staff must not reach the queue (it treats non-doctors as reception)
  r = await call("GET", `/api/queue?docId=${docA._id}`, { token: labUser });
  check("Lab login can't open or run doctors' queues", r.status === 403, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  r = await call("GET", "/api/notifications", { token: labUser });
  check("Lab login has its own notification inbox", r.data.success === true);

  // --- Test list ---
  r = await call("POST", "/api/lab/tests/add-common", { token: labUser });
  check("Lab adds the common test list", r.data.success && r.data.added > 20, JSON.stringify(r.data));
  r = await call("POST", "/api/lab/tests/add-common", { token: labUser });
  check("Adding common tests twice adds nothing", r.data.added === 0);
  r = await call("POST", "/api/lab/tests", { token: labUser, body: { name: "cbc (complete blood count)" } });
  check("Duplicate test name refused (any letter case)", !r.data.success && /already exists/.test(r.data.message), JSON.stringify(r.data));
  r = await call("POST", "/api/lab/tests", { token: doctorA, body: { name: "Doctor test" } });
  check("Doctors can't edit the test list", r.status === 403);
  r = await call("GET", "/api/lab/tests", { token: doctorA });
  const tests = r.data.tests;
  const cbc = tests.find((t) => t.name.startsWith("CBC"));
  const lft = tests.find((t) => t.name.startsWith("LFT"));
  const urine = tests.find((t) => t.name.startsWith("Urine R/E"));
  r = await call("PUT", `/api/lab/tests/${cbc._id}`, { token: labUser, body: { price: 900 } });
  r = await call("PUT", `/api/lab/tests/${cbc._id}`, { token: labUser, body: { price: "" } });
  check("A test's price can be cleared", r.data.success && !("price" in r.data.test), JSON.stringify(r.data.test));
  r = await call("PUT", `/api/lab/tests/${urine._id}`, { token: labUser, body: { active: false } });
  r = await call("GET", "/api/lab/tests", { token: doctorA });
  check("Turned-off tests are hidden from doctors", !r.data.tests.some((t) => t._id === urine._id));

  // --- Ordering ---
  const today = hospitalSlotDate(new Date());
  const apt = await svc.bookAppointment({ patient, doctor: docA, slotDate: hospitalSlotDate(new Date(), 1), slotTime: "10:00 AM", amount: 1000, actor: { role: "admin" } });
  r = await call("POST", "/api/lab/orders", { token: doctorA, body: { appointmentId: apt._id, testIds: [urine._id], note: "x" } });
  check("Can't order a turned-off test", !r.data.success);
  r = await call("POST", "/api/lab/orders", { token: doctorB, body: { appointmentId: apt._id, testIds: [cbc._id] } });
  check("A doctor can't order for another doctor's appointment", !r.data.success);
  r = await call("POST", "/api/lab/orders", { token: labUser, body: { appointmentId: apt._id, testIds: [cbc._id] } });
  check("Lab staff can't create requests", r.status === 403);
  pushed.length = 0;
  r = await call("POST", "/api/lab/orders", { token: doctorA, body: { appointmentId: apt._id, testIds: [cbc._id, lft._id], urgent: true, note: "Fever 5 days, check platelets" } });
  check("Doctor sends a request from an appointment", r.data.success && r.data.order.orderNumber === 1 && r.data.order.tests.length === 2, JSON.stringify(r.data).slice(0, 200));
  const order1 = r.data.order;
  check("Lab gets a live alert for the new request", pushed.some((p) => p.room === "lab" && p.type === "lab_order"));

  // Walk-in from the queue (no patient record)
  const token = (await q.issueToken({ docId: String(docA._id), patientName: "Walk-in Zahid", phone: "03215550000", age: "45", gender: "Male", actor: { role: "admin" } })).token;
  r = await call("POST", "/api/lab/orders", { token: doctorA, body: { queueTokenId: token._id, testIds: [cbc._id] } });
  check("Doctor sends a request for a walk-in from the queue", r.data.success && r.data.order.patient.name === "Walk-in Zahid" && r.data.order.orderNumber === 2);
  check("Walk-in's age and gender from reception reach the lab", r.data.order.patient.age === "45 y" && r.data.order.patient.gender === "Male", JSON.stringify(r.data.order?.patient));
  let ageErr = "";
  try { await q.issueToken({ docId: String(docA._id), patientName: "Bad Age", age: "forty", actor: { role: "admin" } }); } catch (e) { ageErr = e.message; }
  check("Age must be a number", /age/i.test(ageErr));
  const order2 = r.data.order;
  r = await call("POST", "/api/lab/orders", { token: doctorB, body: { queueTokenId: token._id, testIds: [cbc._id] } });
  check("Another doctor can't use this doctor's queue token", !r.data.success);

  // --- Lab worklist and details ---
  r = await call("GET", "/api/lab/orders", { token: labUser });
  check("Lab sees open requests, urgent first", r.data.success && r.data.orders[0]._id === order1._id && r.data.counts.open === 2, JSON.stringify(r.data.counts));
  r = await call("GET", "/api/lab/orders?search=rehana", { token: labUser });
  check("Lab searches by patient name", r.data.orders.length === 1);
  r = await call("GET", "/api/lab/orders?search=L-2", { token: labUser });
  check("Lab searches by request number", r.data.orders.length === 1 && r.data.orders[0]._id === order2._id);
  r = await call("GET", `/api/lab/orders/${order1._id}`, { token: labUser });
  check("Lab sees patient details (age, gender, phone, address, last 4 of CNIC)",
    r.data.patient.gender === "Female" && r.data.patient.dob && r.data.patient.address.includes("Islampura") && r.data.patient.cnicLast4 === "5671" && !("cnic" in r.data.patient),
    JSON.stringify(r.data.patient));
  r = await call("GET", "/api/lab/orders", { token: doctorB });
  check("Another doctor doesn't see these requests", r.data.orders.length === 0);
  r = await call("GET", `/api/lab/orders/${order1._id}`, { token: doctorB });
  check("Another doctor can't open the request", !r.data.success);

  // --- Upload ---
  const pdf = new Blob(["%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"], { type: "application/pdf" });
  const form = (file, name, note) => {
    const f = new FormData();
    f.append("report", file, name);
    if (note) f.append("note", note);
    return f;
  };
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: labUser, form: form(new Blob(["MZ"], { type: "application/x-msdownload" }), "virus.exe") });
  check("Upload refuses files that aren't PDF or images", r.status === 400 && /PDF/.test(r.data.message), JSON.stringify(r.data));
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: doctorA, form: form(pdf, "cbc.pdf") });
  check("Doctors can't upload reports", r.status === 403);
  pushed.length = 0;
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: labUser, form: form(pdf, "cbc.pdf", "Platelets 85,000, called Dr. Amina") });
  check("Lab uploads the report", r.data.success && r.data.order.status === "report_uploaded");
  check("Doctor gets a live alert for the report", pushed.some((p) => p.room === `doctor_${docA._id}` && p.type === "lab_report"));
  check("Report file is in storage", fs.readdirSync(tmp).length === 1);

  r = await call("GET", "/api/lab/orders/counts", { token: doctorA });
  check("Doctor's badge shows 1 report to review", r.data.counts.toReview === 1);

  // Download through a short-lived link
  r = await call("GET", `/api/lab/orders/${order1._id}/report-link`, { token: doctorB });
  check("Another doctor can't get the report link", !r.data.success);
  r = await call("GET", `/api/lab/orders/${order1._id}/report-link`, { token: doctorA });
  check("Doctor gets a report link", r.data.success && r.data.url.startsWith("/api/lab/files/"));
  const file = await fetch(base + r.data.url);
  const body = await file.text();
  check("Report link opens the PDF inline", file.ok && file.headers.get("content-type") === "application/pdf" && body.startsWith("%PDF") && /inline/.test(file.headers.get("content-disposition")));
  const expired = jwt.sign({ purpose: "lab-report", order: order1._id, report: "x" }, process.env.JWT_SECRET, { expiresIn: -10 });
  check("Expired link refused", (await fetch(`${base}/api/lab/files/${expired}`)).status === 403);
  const loginToken = doctorA.dtoken;
  check("A login token can't be used as a file link", (await fetch(`${base}/api/lab/files/${loginToken}`)).status === 403);

  // --- Review ---
  const shownId = () => labOrderModel.findById(order1._id).lean().then((o) => String(o.reports[o.reports.length - 1]._id));
  let shown = await shownId();
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: labUser, body: { decision: "approve", reportId: shown } });
  check("Lab can't approve its own report", r.status === 403);
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorB, body: { decision: "approve", reportId: shown } });
  check("Another doctor can't approve", !r.data.success);
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "return", reportId: shown } });
  check("Returning needs a note", !r.data.success);
  pushed.length = 0;
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "return", note: "Please repeat platelet count", reportId: shown } });
  check("Doctor returns the report with a note", r.data.success && r.data.order.status === "returned");
  check("Lab gets an alert about the return", pushed.some((p) => p.room === "lab" && p.type === "lab_report_returned"));
  r = await call("GET", "/api/lab/orders", { token: labUser });
  check("Returned request is back in the lab's open list", r.data.orders.some((o) => o._id === order1._id && o.status === "returned"));
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: labUser, form: form(pdf, "cbc-repeat.pdf", "Repeated: 90,000") });
  check("Lab uploads again; both files kept", r.data.success && r.data.order.reports.length === 2);
  // The doctor is looking at the first re-upload; the lab replaces it before the doctor decides
  const seen = await shownId();
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: labUser, form: form(pdf, "cbc-corrected.pdf", "Corrected typo") });
  check("Lab can replace a report the doctor hasn't reviewed", r.data.success && r.data.order.reports.length === 3);
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "approve", reportId: seen } });
  check("Approving the older report the doctor saw is refused", !r.data.success && /newer report/.test(r.data.message), JSON.stringify(r.data));
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "approve" } });
  check("Approving without naming the report is refused", !r.data.success);
  shown = await shownId();
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "approve", reportId: shown } });
  check("Doctor approves", r.data.success && r.data.order.status === "approved");
  r = await call("POST", `/api/lab/orders/${order1._id}/review`, { token: doctorA, body: { decision: "approve", reportId: shown } });
  check("Can't review twice", !r.data.success);
  r = await call("POST", `/api/lab/orders/${order1._id}/report`, { token: labUser, form: form(pdf, "late.pdf") });
  check("No uploads after approval", !r.data.success);

  // --- Cancel ---
  r = await call("POST", `/api/lab/orders/${order2._id}/cancel`, { token: labUser, body: {} });
  check("Lab can't cancel a doctor's request", r.status === 403);
  r = await call("POST", `/api/lab/orders/${order2._id}/cancel`, { token: doctorA, body: { note: "Ordered by mistake" } });
  check("Doctor cancels a request", r.data.success && r.data.order.status === "cancelled");
  r = await call("POST", `/api/lab/orders/${order2._id}/report`, { token: labUser, form: form(pdf, "x.pdf") });
  check("Lab can't upload to a cancelled request", !r.data.success);

  // --- Accounts turned off stop working at once ---
  await call("PUT", `/api/lab/staff/${staffId}`, { token: admin, body: { active: false } });
  r = await call("GET", "/api/lab/orders", { token: labUser });
  check("Turned-off lab account is logged out at once", r.status === 401);
  r = await call("GET", "/api/notifications", { token: labUser });
  check("Turned-off lab account can't read the lab inbox", r.status === 401);
  r = await call("POST", "/api/lab/login", { body: { email: "lab@hospital.pk", password: "lab-pass-123" } });
  check("Turned-off lab account can't log in", !r.data.success && /turned off/.test(r.data.message));

  // --- History and notifications recorded ---
  const final = await labOrderModel.findById(order1._id).lean();
  check("History records every step", final.history.map((h) => h.action).join(",") === "ordered,report_uploaded,returned,report_uploaded,report_replaced,approved", final.history.map((h) => h.action).join(","));
  check("Notifications saved for lab and doctor", (await notificationModel.countDocuments({ recipientType: "lab" })) >= 3 && (await notificationModel.countDocuments({ recipientType: "doctor", type: "lab_report" })) === 3);

  // --- Switch ---
  process.env.LAB_ENABLED = "false";
  r = await call("GET", "/api/lab/orders", { token: doctorA });
  check("LAB_ENABLED=false turns the module off", r.status === 404);
  delete process.env.LAB_ENABLED;
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL LAB CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
