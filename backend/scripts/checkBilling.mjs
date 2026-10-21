// End-to-end checks for billing and the shared reception login, through the real
// HTTP routes: who may do what, collecting at the token, lab charges, two
// receptionists at once, refunds, closing a counter, and the owner's summary.
// Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "check-billing-secret";
process.env.ADMIN_EMAIL = "owner@hmc.com";
process.env.ADMIN_PASSWORD = "owner-pass-1";
process.env.RECEPTION_EMAIL = "desk@hmc.com";
process.env.RECEPTION_PASSWORD = "desk-pass-1";
process.env.WHATSAPP_PROVIDER = "none";
delete process.env.LAB_ENABLED;
delete process.env.BILLING_ENABLED;

const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_billingcheck_" + Date.now() });

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { default: authRoutes } = await import("../routes/authRoutes.js");
const { default: adminRouter } = await import("../routes/adminRoute.js");
const { default: queueRouter } = await import("../routes/queueRoute.js");
const { default: labRouter } = await import("../routes/labRoute.js");
const { default: billingRouter } = await import("../routes/billingRoute.js");
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const { labTestModel, labOrderModel } = await import("../model/labModel.js");
const { paymentModel, refundModel } = await import("../model/billingModel.js");
const { queueTokenModel } = await import("../model/queueModel.js");

const app = express();
app.use(express.json());
app.set("io", { to: () => ({ emit: () => {} }) });
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRouter);
app.use("/api/queue", queueRouter);
app.use("/api/lab", labRouter);
app.use("/api/billing", billingRouter);
app.use((err, req, res, next) => res.status(err.status || 400).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""}`);
  if (!cond) failures++;
};
const call = async (method, url, token, body) => {
  const headers = { ...(token || {}) };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
};
const login = (email, password) => call("POST", "/api/auth/login", null, { email, password });

try {
  const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1h" });
  const docA = await doctorModel.create({ name: "Imran", email: "imran@x", password: "x", image: "i", speciality: "Medicine", degree: "d", experience: "1", about: "a", fee: 1500, address: {}, date: Date.now(), timings: { start: "00:00", end: "23:59" }, hospitalSharePercent: 30 });
  const docB = await doctorModel.create({ name: "Sana", email: "sana@x", password: "x", image: "i", speciality: "Gynae", degree: "d", experience: "1", about: "a", fee: 2000, address: {}, date: Date.now(), timings: { start: "00:00", end: "23:59" } });
  const doctorA = { dtoken: sign({ role: "doctor", id: String(docA._id) }) };

  // --- Logins ---
  let r = await login("desk@hmc.com", "desk-pass-1");
  check("Reception email signs in as reception", r.data.success && r.data.role === "reception");
  const desk = { atoken: r.data.token };
  r = await login("DESK@hmc.com", "desk-pass-1");
  check("Reception email in capitals still works", r.data.success && r.data.role === "reception");
  r = await login("desk@hmc.com", "wrong");
  check("Reception with wrong password is refused", !r.data.success);
  r = await login("owner@hmc.com", "owner-pass-1");
  check("Owner still signs in as admin", r.data.success && r.data.role === "admin");
  const owner = { atoken: r.data.token };

  // --- What reception may and may not do ---
  r = await call("GET", "/api/admin/dashboard", desk);
  check("Reception sees the dashboard", r.status === 200 && r.data.success);
  r = await call("POST", "/api/admin/all-doctors", desk, {});
  check("Reception sees the doctors list", r.data.success && r.data.doctors.length === 2);
  r = await call("GET", "/api/admin/appointments", desk);
  check("Reception sees appointments", r.data.success);
  r = await call("GET", "/api/admin/leave-stats", desk);
  check("Reception sees leave counts (sidebar badge)", r.status === 200);
  for (const [method, url, label] of [
    ["GET", "/api/admin/profit", "the profit report"],
    ["PUT", `/api/admin/update-doctor/${docA._id}`, "changing a doctor (fee/share)"],
    ["DELETE", `/api/admin/delete-doctor/${docA._id}`, "deleting a doctor"],
    ["POST", "/api/admin/approve-leave", "approving leave"],
    ["GET", "/api/admin/system-status", "system settings"],
    ["GET", "/api/lab/staff", "lab staff accounts"],
    ["GET", "/api/billing/summary", "the money summary"],
    ["PUT", "/api/billing/settings", "billing settings"],
  ]) {
    r = await call(method, url, desk, method === "GET" ? undefined : {});
    // 403, not 401: the app must not log reception out
    check(`Reception is refused ${label} with 403`, r.status === 403, `${r.status} ${r.data.message}`);
  }
  r = await call("GET", "/api/admin/profit", owner);
  check("Owner still sees the profit report", r.status === 200 && r.data.success);
  r = await call("GET", "/api/admin/dashboard", owner);
  check("Owner still sees the dashboard", r.data.success);

  // --- Queue with the reception login ---
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docA._id), patientName: "Rashid", phone: "03001112223", fee: 1500 });
  check("Reception gives a walk-in token", r.data.success && r.data.token.number === 1, r.data.message);
  const tokenRashid = r.data.token;
  const visitRashid = await appointmentModel.findById(tokenRashid.appointmentId).lean();
  check("The walk-in visit is recorded as admin/reception", visitRashid?.createdBy?.role === "admin" && visitRashid?.createdBy?.id === "reception");
  r = await call("GET", "/api/queue", desk, undefined);
  check("Queue needs a doctor for reception (as for admin)", r.data.success === false);
  r = await call("GET", `/api/queue?docId=${docA._id}`, desk);
  check("Reception sees the doctor's queue", r.data.success && r.data.queue.tokens.length === 1);

  // --- Billing settings ---
  r = await call("GET", "/api/billing/status");
  check("Billing is on by default", r.data.enabled === true);
  r = await call("GET", "/api/billing/settings", desk);
  check("A default counter exists", r.data.success && r.data.settings.counters.length === 1 && r.data.settings.counters[0].name === "Reception");
  r = await call("PUT", "/api/billing/settings", owner, {
    counters: [...r.data.settings.counters, { name: "Counter 2" }],
    staff: [{ name: "Ayesha" }, { name: "Bilal" }],
  });
  check("Owner adds a counter and names", r.data.success && r.data.settings.counters.length === 2 && r.data.settings.staff.length === 2);
  const [counter1, counter2] = r.data.settings.counters;
  r = await call("PUT", "/api/billing/settings", owner, { counters: [{ ...counter1, active: false }, { ...counter2, active: false }] });
  check("At least one counter must stay on", !r.data.success);

  // --- Due and collect ---
  r = await call("GET", "/api/billing/due", desk);
  check("Rashid's fee is due", r.data.success && r.data.due.visits.length === 1 && r.data.due.visits[0].amount === 1500);
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "cash" });
  check("Collect needs this computer's counter", !r.data.success && r.data.code === "counter_required");
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "card", counterId: counter1.id });
  check("Only cash or bank transfer", !r.data.success);

  const rid = "req-rashid-1";
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "cash", counterId: counter1.id, staffName: "Ayesha", requestId: rid });
  check("Ayesha collects Rs 1500 cash", r.data.success && r.data.payment.net === 1500 && r.data.payment.collectedBy.name === "Ayesha" && r.data.payment.collectedBy.role === "reception");
  check("Receipt number is ddmmyy-0001", /^\d{6}-0001$/.test(r.data.payment.receiptNo), r.data.payment.receiptNo);
  const receipt1 = r.data.payment;
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "cash", counterId: counter1.id, staffName: "Ayesha", requestId: rid });
  check("Same request again (double click) returns the same receipt", r.data.success && r.data.repeated && r.data.payment.receiptNo === receipt1.receiptNo);
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "cash", counterId: counter2.id, staffName: "Bilal" });
  check("A second Collect for the same visit is refused", !r.data.success && r.data.code === "already_paid" && /Ayesha/.test(r.data.message), r.data.message);
  r = await call("GET", "/api/billing/due", desk);
  check("Rashid is no longer due", r.data.due.visits.length === 0);
  check("Visit fee unchanged when there's no discount", (await appointmentModel.findById(tokenRashid.appointmentId).lean()).amount === 1500);

  // Two receptionists press Collect for the same patient at the same moment
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docA._id), patientName: "Naseem", fee: 1500 });
  const tokenNaseem = r.data.token;
  const [x, y] = await Promise.all([
    call("POST", "/api/billing/collect", desk, { appointmentId: tokenNaseem.appointmentId, method: "cash", counterId: counter1.id, staffName: "Ayesha" }),
    call("POST", "/api/billing/collect", desk, { appointmentId: tokenNaseem.appointmentId, method: "cash", counterId: counter2.id, staffName: "Bilal" }),
  ]);
  check("Two at once: exactly one receipt", [x, y].filter((z) => z.data.success).length === 1, [x.data.message, y.data.message]);
  check("Two at once: the other is told it's already paid", [x, y].some((z) => z.data.code === "already_paid"));
  check("Two at once: one payment saved", (await paymentModel.countDocuments({ appointmentId: tokenNaseem.appointmentId })) === 1);
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docB._id), patientName: "Rush", fee: 2000 });
  const tokenRush = r.data.token;
  const five = await Promise.all(
    [1, 2, 3, 4, 5].map(() => call("POST", "/api/billing/collect", desk, { appointmentId: tokenRush.appointmentId, method: "cash", counterId: counter2.id, staffName: "Bilal" }))
  );
  check("Five at once: exactly one receipt", five.filter((z) => z.data.success).length === 1, five.map((z) => z.data.message));

  // Discount allowed by the doctor
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docA._id), patientName: "Kashif", fee: 1500 });
  const tokenKashif = r.data.token;
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenKashif.appointmentId, method: "cash", counterId: counter1.id, discount: 500 });
  check("A discount needs the doctor who allowed it", !r.data.success);
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenKashif.appointmentId, method: "cash", counterId: counter1.id, discount: 2000, discountAllowedBy: String(docA._id) });
  check("A discount can't be more than the fee", !r.data.success);
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenKashif.appointmentId, method: "bank_transfer", reference: "TX123", counterId: counter2.id, staffName: "Bilal", discount: 500, discountAllowedBy: String(docA._id), discountReason: "neighbour" });
  check("Bilal collects Rs 1000 by bank transfer after Rs 500 discount", r.data.success && r.data.payment.net === 1000 && r.data.payment.discountAllowedBy.name === "Imran" && r.data.payment.reference === "TX123");
  check("The visit now earns Rs 1000", (await appointmentModel.findById(tokenKashif.appointmentId).lean()).amount === 1000);

  // Collect later: stays due, and a cancelled visit can't be charged
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docB._id), patientName: "Fatima", fee: 2000 });
  const tokenFatima = r.data.token;
  r = await call("GET", "/api/billing/due", desk);
  check("Fatima (collect later) is on the due list", r.data.due.visits.some((v) => v.appointmentId === tokenFatima.appointmentId));
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docB._id), patientName: "Gone Home", fee: 2000 });
  const tokenGone = r.data.token;
  await call("POST", "/api/queue/action", desk, { docId: String(docB._id), tokenId: tokenGone._id, action: "left" });
  r = await call("GET", "/api/billing/due", desk);
  check("A patient who left isn't due", !r.data.due.visits.some((v) => v.appointmentId === tokenGone.appointmentId));
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenGone.appointmentId, method: "cash", counterId: counter1.id });
  check("A cancelled visit can't be charged", !r.data.success);

  // --- Lab charges ---
  const cbc = await labTestModel.create({ name: "CBC", price: 800, active: true });
  const typhi = await labTestModel.create({ name: "Typhidot", active: true }); // no price in the list
  r = await call("POST", "/api/lab/orders", doctorA, { queueTokenId: tokenRashid._id, testIds: [String(cbc._id), String(typhi._id)] });
  check("Doctor requests CBC + Typhidot for Rashid", r.data.success, r.data.message);
  const order = r.data.order;
  r = await call("GET", "/api/billing/due", desk);
  const labDue = r.data.due.lab.find((o) => o.labOrderId === String(order._id));
  check("Lab charges are due at reception", Boolean(labDue) && labDue.items[0].price === 800 && labDue.items[1].price === null && labDue.total === null);
  r = await call("GET", "/api/lab/orders?status=all", desk);
  check("Reception sees lab requests", r.data.success && r.data.orders.length === 1 && !r.data.orders[0].payment);
  r = await call("POST", `/api/lab/orders/${order._id}/cancel`, desk, {});
  check("Reception can't cancel a lab request", r.status === 403);
  r = await call("POST", "/api/billing/collect", desk, { labOrderId: String(order._id), method: "cash", counterId: counter1.id, items: [{ amount: 800 }] });
  check("Every test needs a price", !r.data.success);
  r = await call("POST", "/api/billing/collect", desk, { labOrderId: String(order._id), method: "cash", counterId: counter1.id, staffName: "Ayesha", items: [{ amount: 800 }, { amount: 1200 }] });
  check("Ayesha collects Rs 2000 lab charges", r.data.success && r.data.payment.net === 2000 && r.data.payment.kind === "lab" && r.data.payment.items.length === 2);
  const labReceipt = r.data.payment;
  const paidOrder = await labOrderModel.findById(order._id).lean();
  check("The lab request shows as paid", paidOrder.payment?.receiptNo === labReceipt.receiptNo);
  r = await call("GET", "/api/billing/due", desk);
  check("Paid lab request is no longer due", !r.data.due.lab.some((o) => o.labOrderId === String(order._id)));

  // --- Refunds (owner only) ---
  r = await call("POST", `/api/billing/payments/${labReceipt._id}/refund`, desk, { amount: 1200, reason: "Test not done" });
  check("Reception can't refund", r.status === 403);
  r = await call("POST", `/api/billing/payments/${labReceipt._id}/refund`, owner, { amount: 1200 });
  check("A refund needs a reason", !r.data.success);
  r = await call("POST", `/api/billing/payments/${labReceipt._id}/refund`, owner, { amount: 1200, reason: "Typhidot not done" });
  check("Owner refunds Rs 1200 of the lab receipt", r.data.success && r.data.payment.status === "partly_refunded");
  r = await call("POST", `/api/billing/payments/${labReceipt._id}/refund`, owner, { amount: 1000, reason: "too much" });
  check("Can't refund more than was paid", !r.data.success && /800/.test(r.data.message), r.data.message);
  r = await call("POST", `/api/billing/payments/${receipt1._id}/refund`, owner, { amount: 1500, reason: "Wrong doctor" });
  check("Owner refunds Rashid's fee in full", r.data.success && r.data.payment.status === "refunded");
  r = await call("POST", "/api/billing/collect", desk, { appointmentId: tokenRashid.appointmentId, method: "cash", counterId: counter1.id, staffName: "Ayesha" });
  check("After a full refund the visit can be paid again", r.data.success);

  // --- Closing Counter 1 ---
  // Counter 1 cash: Rashid 1500 + Naseem (if Ayesha won) + lab 2000 + Rashid again 1500; refunds 1200 + 1500
  const naseemAt1 = x.data.success ? 1500 : 0;
  const expected1 = 1500 + naseemAt1 + 2000 + 1500 - 1200 - 1500;
  r = await call("GET", `/api/billing/close-preview?counterId=${counter1.id}`, desk);
  check("Counter 1 should hold the cash in minus cash refunds", r.data.success && r.data.preview.expected === expected1, `${r.data.preview?.expected} vs ${expected1}`);
  r = await call("POST", "/api/billing/close", desk, { counterId: counter1.id, countedCash: expected1 - 200, staffName: "Ayesha" });
  check("Short drawer without a note is refused", !r.data.success && r.data.code === "note_required" && r.data.expected === expected1);
  check("Refused close leaves payments uncounted", (await paymentModel.countDocuments({ counterId: counter1.id, closeId: { $ne: null } })) === 0);
  r = await call("POST", "/api/billing/close", desk, { counterId: counter1.id, countedCash: expected1 - 200, note: "Change given wrong", staffName: "Ayesha", notes: { 1000: 2, abc: 5 } });
  check("Close with a note saves the difference", r.data.success && r.data.close.difference === -200 && r.data.close.closedBy.name === "Ayesha");
  const close1 = r.data.close;
  r = await call("GET", `/api/billing/close-preview?counterId=${counter1.id}`, desk);
  check("After closing, Counter 1 starts from zero", r.data.preview.expected === 0 && r.data.preview.receipts === 0);
  check("Refunds are counted in that close", (await refundModel.countDocuments({ closeId: String(close1._id) })) === 2);
  // A double click on "Close counter" (or a retry after a slow network) closes once
  {
    const { cashCloseModel } = await import("../model/billingModel.js");
    const before = await cashCloseModel.countDocuments({ counterId: counter1.id });
    const same = { counterId: counter1.id, countedCash: 0, staffName: "Ayesha", requestId: "close-req-1" };
    const [c1, c2] = await Promise.all([call("POST", "/api/billing/close", desk, same), call("POST", "/api/billing/close", desk, same)]);
    const c3 = await call("POST", "/api/billing/close", desk, same);
    const ids = [c1, c2, c3].map((x) => x.data.close?._id);
    check("Close counter: the same request twice at once (and again later) saves one close",
      c1.data.success && c2.data.success && c3.data.success && new Set(ids).size === 1 && (await cashCloseModel.countDocuments({ counterId: counter1.id })) === before + 1,
      JSON.stringify([c1.data, c2.data].map((x) => x.message || x.close?._id)));
  }
  r = await call("POST", `/api/billing/closes/${close1._id}/verify`, desk, {});
  check("Reception can't verify its own close", r.status === 403);
  r = await call("POST", `/api/billing/closes/${close1._id}/verify`, owner, {});
  check("Owner verifies the close", r.data.success && r.data.close.verifiedAt);
  r = await call("POST", `/api/billing/closes/${close1._id}/verify`, owner, {});
  check("A close is verified only once", !r.data.success);

  // --- Owner's summary ---
  r = await call("GET", "/api/billing/summary", owner);
  const s = r.data.summary;
  const all = await paymentModel.find().lean();
  check("Summary loads", r.data.success, r.data.message);
  check("Collected = sum of receipts", s.totals.collected === all.reduce((t, p) => t + p.net, 0));
  check("Refunds total Rs 2700", s.totals.refunds === 2700);
  check("Bank transfer Rs 1000", s.totals.bankTransfer === 1000);
  const imran = s.byDoctor.find((d) => d.name === "Imran");
  check("Imran's split is 30% hospital", imran && imran.hospitalShare + imran.doctorShare === imran.consultation && imran.hospitalShare === Math.round(imran.consultation * 0.3), JSON.stringify(imran));
  check("Imran allowed Rs 500 discount", imran?.discountsAllowed === 500);
  check("Fatima is in the unpaid list", s.unpaid.visits.some((v) => v.patientName === "Fatima"));
  // Two closes: the short one (-200) and the single close from the double-click check
  check("Closes listed with the difference", s.closes.length === 2 && s.closes.some((c) => c.difference === -200));
  check("No receipt number gaps", s.receiptGaps.length === 0, JSON.stringify(s.receiptGaps));
  check("Per person totals", s.byStaff.some((p) => p.name === "Ayesha") && s.byStaff.some((p) => p.name === "Bilal"));

  // --- Billing off ---
  process.env.BILLING_ENABLED = "false";
  r = await call("GET", "/api/billing/status");
  check("BILLING_ENABLED=false turns billing off", r.data.enabled === false);
  r = await call("GET", "/api/billing/due", desk);
  check("Billing routes answer 404 when off", r.status === 404);
  r = await call("POST", "/api/queue/issue", desk, { docId: String(docA._id), patientName: "Still Works", fee: 1500 });
  check("The queue works with billing off", r.data.success);
  delete process.env.BILLING_ENABLED;

  // --- Without a reception login set up, only the owner can sign in at the desk ---
  delete process.env.RECEPTION_EMAIL;
  r = await login("desk@hmc.com", "desk-pass-1");
  check("No reception login unless RECEPTION_EMAIL is set", !r.data.success);
  check("Queue tokens untouched by billing", (await queueTokenModel.countDocuments()) === 7);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll billing checks passed");
process.exit(failures ? 1 : 0);
