// Checks that billing saves are all-or-nothing (MongoDB transactions): a failure
// halfway through collecting or refunding leaves nothing behind (no payment without
// its receipt number or lab order, no refunded amount without its refund record),
// and receipt numbers stay without gaps. Also many patients paying at once.
// Run with: npm run check:integration
//
// Transactions need a replica set (Atlas always is one). Set CHECK_MONGODB_RS_URI to
// a local single-node replica set, e.g. mongodb://127.0.0.1:27018 (see CI). Without
// one these checks are skipped; billing then works without transactions, as before.
const rsUri = process.env.CHECK_MONGODB_RS_URI || "";
if (!rsUri) {
  console.log("SKIP  billing transaction checks: set CHECK_MONGODB_RS_URI to a local replica set to run them");
  process.exit(0);
}
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rsUri)) {
  console.error("Refusing to run: CHECK_MONGODB_RS_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
process.env.WHATSAPP_PROVIDER = "none";
delete process.env.BILLING_ENABLED;

const mongoose = (await import("mongoose")).default;
await mongoose.connect(rsUri, { dbName: "qclinics_billingtx_" + Date.now() });

const billing = await import("../services/billingService.js");
const { default: appointmentModel } = await import("../model/appointmentModel.js");
const { labOrderModel } = await import("../model/labModel.js");
const { paymentModel, refundModel, receiptCounterModel } = await import("../model/billingModel.js");

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const by = { role: "admin", name: "Owner" };
// Make one model method fail once, like a crash or a lost connection mid-save
const failOnce = (model, method) => {
  const original = model[method];
  model[method] = function (...args) {
    model[method] = original;
    throw new Error(`simulated failure in ${model.modelName}.${method}`);
  };
  return () => (model[method] = original);
};
const today = billing.todayIso();
const counterSeq = async () => (await receiptCounterModel.findById(today).lean())?.seq || 0;

try {
  await Promise.all([paymentModel.init(), refundModel.init(), receiptCounterModel.init(), labOrderModel.init(), appointmentModel.init()]);
  const { counters } = await billing.getSettings();
  const counterId = counters[0].id;
  const visit = (name, amount) =>
    appointmentModel.create({
      userId: new mongoose.Types.ObjectId().toString(), docId: new mongoose.Types.ObjectId().toString(),
      slotDate: "21_10_2026", slotTime: "10:00 AM", startAt: new Date(), userData: { name }, docData: { name: "Imran" },
      amount, date: Date.now(), status: "booked",
    });
  const labOrder = (n) =>
    labOrderModel.create({ orderNumber: n, docId: "d1", doctor: { name: "Imran" }, patient: { name: `Lab patient ${n}` }, tests: [{ name: "CBC" }, { name: "LFT" }] });

  // --- Collect a lab payment: failure after the payment, before the lab order is marked paid ---
  const order = await labOrder(1);
  const seqBefore = await counterSeq();
  let restore = failOnce(labOrderModel, "updateOne");
  let error = null;
  try {
    await billing.collect({ labOrderId: String(order._id), items: [{ amount: 800 }, { amount: 1200 }], method: "cash", counterId }, by);
  } catch (e) {
    error = e;
  }
  restore();
  check("Lab payment: the failure is reported", /simulated failure/.test(error?.message || ""), error?.message);
  check("Lab payment: no payment saved", (await paymentModel.countDocuments({ labOrderId: String(order._id) })) === 0);
  check("Lab payment: no receipt number used up (no gap)", (await counterSeq()) === seqBefore, `${seqBefore} -> ${await counterSeq()}`);
  check("Lab payment: the lab order is still unpaid", !(await labOrderModel.findById(order._id).lean()).payment);
  const retry = await billing.collect({ labOrderId: String(order._id), items: [{ amount: 800 }, { amount: 1200 }], method: "cash", counterId }, by);
  check("Lab payment: trying again works, with the next receipt number", retry.payment.seq === seqBefore + 1 && retry.payment.net === 2000);
  check("Lab payment: the lab order is marked paid", (await labOrderModel.findById(order._id).lean()).payment?.receiptNo === retry.payment.receiptNo);

  // --- Discounted visit: failure while lowering the visit's fee ---
  const v1 = await visit("Rashid Ali", 2000);
  const doctorId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection("doctors").insertOne({ _id: doctorId, name: "Imran" });
  restore = failOnce(appointmentModel, "updateOne");
  error = null;
  try {
    await billing.collect({ appointmentId: String(v1._id), discount: 500, discountAllowedBy: String(doctorId), method: "cash", counterId }, by);
  } catch (e) {
    error = e;
  }
  restore();
  check("Discounted visit: the failure is reported", /simulated failure/.test(error?.message || ""), error?.message);
  check("Discounted visit: no payment saved", (await paymentModel.countDocuments({ appointmentId: String(v1._id) })) === 0);
  check("Discounted visit: the fee is unchanged", (await appointmentModel.findById(v1._id).lean()).amount === 2000);
  const paid = await billing.collect({ appointmentId: String(v1._id), discount: 500, discountAllowedBy: String(doctorId), method: "cash", counterId }, by);
  check("Discounted visit: trying again works (net 1500, fee lowered)", paid.payment.net === 1500 && (await appointmentModel.findById(v1._id).lean()).amount === 1500);

  // --- Refund: failure after the amount is counted, before the refund record ---
  restore = failOnce(refundModel, "create");
  error = null;
  try {
    await billing.refund({ paymentId: String(paid.payment._id), amount: 400, reason: "Wrong doctor", counterId }, by);
  } catch (e) {
    error = e;
  }
  restore();
  let p = await paymentModel.findById(paid.payment._id).lean();
  check("Refund: the failure is reported", /simulated failure/.test(error?.message || ""), error?.message);
  check("Refund: the refunded amount is unchanged (the drawer still adds up)", p.refunded === 0 && p.status !== "partly_refunded", JSON.stringify({ refunded: p.refunded, status: p.status }));
  check("Refund: no refund record", (await refundModel.countDocuments({ paymentId: String(paid.payment._id) })) === 0);
  await billing.refund({ paymentId: String(paid.payment._id), amount: 400, reason: "Wrong doctor", counterId }, by);
  p = await paymentModel.findById(paid.payment._id).lean();
  check("Refund: trying again works (refunded 400, partly refunded, one record)", p.refunded === 400 && p.status === "partly_refunded" && (await refundModel.countDocuments({ paymentId: String(paid.payment._id) })) === 1);

  // --- Full refund of a lab payment: failure while freeing the lab order ---
  restore = failOnce(labOrderModel, "updateOne");
  error = null;
  try {
    await billing.refund({ paymentId: String(retry.payment._id), amount: 2000, reason: "Test not done", counterId }, by);
  } catch (e) {
    error = e;
  }
  restore();
  p = await paymentModel.findById(retry.payment._id).lean();
  check("Full lab refund: nothing changes when it fails", p.refunded === 0 && p.active === true && (await refundModel.countDocuments({ paymentId: String(retry.payment._id) })) === 0 && (await labOrderModel.findById(order._id).lean()).payment);
  await billing.refund({ paymentId: String(retry.payment._id), amount: 2000, reason: "Test not done", counterId }, by);
  p = await paymentModel.findById(retry.payment._id).lean();
  check("Full lab refund: trying again refunds it and frees the lab order", p.refunded === 2000 && p.active === false && p.status === "refunded" && !(await labOrderModel.findById(order._id).lean()).payment);

  // --- Many patients paying at once: all saved, receipt numbers unique and without gaps ---
  const visits = await Promise.all(Array.from({ length: 10 }, (_, i) => visit(`Patient ${i}`, 1000)));
  const start = await counterSeq();
  const results = await Promise.allSettled(visits.map((v) => billing.collect({ appointmentId: String(v._id), method: "cash", counterId }, by)));
  const seqs = results.filter((r) => r.status === "fulfilled").map((r) => r.value.payment.seq).sort((a, b) => a - b);
  check("10 patients at once: all paid", seqs.length === 10, results.filter((r) => r.status === "rejected").map((r) => r.reason?.message).join(" | "));
  check("10 patients at once: receipt numbers unique and consecutive", seqs.join() === Array.from({ length: 10 }, (_, i) => start + 1 + i).join(), seqs.join());
  const same = await visit("Twice", 1000);
  const twice = await Promise.allSettled([0, 1].map(() => billing.collect({ appointmentId: String(same._id), method: "cash", counterId }, by)));
  check("The same visit twice at once: one receipt, the other told it's already paid",
    twice.filter((r) => r.status === "fulfilled").length === 1 && twice.some((r) => r.status === "rejected" && r.reason?.code === "already_paid"),
    JSON.stringify(twice.map((r) => r.status === "fulfilled" ? r.value.payment.receiptNo : r.reason?.message)));
  const summary = await billing.summary({ from: today, to: today });
  check("No receipt number gaps after all this", summary.receiptGaps.length === 0, JSON.stringify(summary.receiptGaps));
  check("No payments left with a temporary receipt number", (await paymentModel.countDocuments({ receiptNo: /^pending-/ })) === 0);
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL BILLING TRANSACTION CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
