import mongoose from "mongoose";
import appointmentModel from "../model/appointmentModel.js";
import doctorModel from "../model/doctorModel.js";
import { labOrderModel, labTestModel } from "../model/labModel.js";
import { queueTokenModel } from "../model/queueModel.js";
import {
  PAYMENT_METHODS,
  paymentModel,
  refundModel,
  cashCloseModel,
  receiptCounterModel,
  billingSettingModel,
} from "../model/billingModel.js";
import { splitFee } from "./profitService.js";
import { hospitalIsoDate, hospitalSlotDate, HOSPITAL_UTC_OFFSET_MINUTES } from "../utils/slots.js";

// Billing at reception. Rules (see docs/BILLING_PLAN.md):
//   - one paid receipt per visit / lab order, enforced by unique indexes
//   - a payment is never edited or deleted; refunds (owner only) correct mistakes
//   - a counter close counts every payment and refund of that counter not yet
//     counted, so nothing is missed or counted twice when people work at once

// Billing on/off for this hospital (BILLING_ENABLED=false hides it)
export const billingEnabled = () => process.env.BILLING_ENABLED !== "false";

export class BillingError extends Error {
  constructor(message, code, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

const isDuplicate = (error) => error?.code === 11000;
const toRupees = (value) => Math.round(Number(value));
const validAmount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const cleanText = (value, max = 200) => String(value ?? "").trim().slice(0, max);

// --- Settings: counters (cash drawers) and receptionists' names ---

const DEFAULT_COUNTER = "Reception";

export const getSettings = async () => {
  let settings = await billingSettingModel.findById("billing").lean();
  if (!settings) {
    try {
      await billingSettingModel.create({ _id: "billing", counters: [{ name: DEFAULT_COUNTER }], staff: [] });
    } catch (error) {
      if (!isDuplicate(error)) throw error; // created at the same moment by another request
    }
    settings = await billingSettingModel.findById("billing").lean();
  }
  // A hospital always has at least one counter
  if (!settings.counters?.length) {
    await billingSettingModel.updateOne({ _id: "billing", "counters.0": { $exists: false } }, { $push: { counters: { name: DEFAULT_COUNTER } } });
    settings = await billingSettingModel.findById("billing").lean();
  }
  return {
    counters: settings.counters.map((c) => ({ id: String(c._id), name: c.name, active: c.active !== false })),
    staff: (settings.staff || []).map((s) => ({ id: String(s._id), name: s.name, active: s.active !== false })),
  };
};

// Replace the lists. Existing entries keep their id (so past receipts still match
// their counter); an entry is never removed, only turned off.
export const saveSettings = async ({ counters, staff }) => {
  const current = await getSettings();
  const merge = (incoming, existing, label) => {
    if (!Array.isArray(incoming)) return existing;
    const rows = incoming
      .map((row) => ({ id: row?.id ? String(row.id) : null, name: cleanText(row?.name, 40), active: row?.active !== false }))
      .filter((row) => row.name);
    const names = rows.map((r) => r.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new BillingError(`Two ${label} have the same name`);
    const kept = existing.map((old) => rows.find((r) => r.id === old.id) || { ...old, active: false });
    const added = rows.filter((r) => !r.id || !existing.some((old) => old.id === r.id));
    return [...kept, ...added.map((r) => ({ id: null, name: r.name, active: r.active }))];
  };
  const counterRows = merge(counters, current.counters, "counters");
  if (!counterRows.some((c) => c.active)) throw new BillingError("Keep at least one counter turned on");
  const staffRows = merge(staff, current.staff, "names");
  const toDoc = (r) => ({ ...(r.id && { _id: new mongoose.Types.ObjectId(r.id) }), name: r.name, active: r.active });
  await billingSettingModel.updateOne(
    { _id: "billing" },
    { $set: { counters: counterRows.map(toDoc), staff: staffRows.map(toDoc) } },
    { upsert: true }
  );
  return getSettings();
};

const findCounter = async (counterId) => {
  const { counters } = await getSettings();
  const counter = counters.find((c) => c.id === String(counterId || ""));
  if (!counter) throw new BillingError("Choose this computer's counter first", "counter_required");
  return counter;
};

// --- Hospital days ---

const OFFSET_MS = HOSPITAL_UTC_OFFSET_MINUTES * 60000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const todayIso = () => hospitalIsoDate(new Date());
// Start of a hospital day ("yyyy-mm-dd") as a real moment
const dayStart = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - OFFSET_MS);
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export const parseRange = (from, to) => {
  const start = ISO_DAY.test(from || "") ? from : todayIso();
  const end = ISO_DAY.test(to || "") ? to : start;
  if (end < start) throw new BillingError("The end date is before the start date");
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 92) throw new BillingError("Choose a period of 3 months or less");
  return { from: start, to: end, start: dayStart(start), end: dayStart(addDays(end, 1)) };
};

// --- All-or-nothing saves ---
// Collecting and refunding write several documents. In a transaction they are saved
// together or not at all, so a failure halfway (lost connection, crash) can't leave a
// payment without its receipt number or lab order, or a refunded amount without its
// refund record (the drawer would no longer add up). Transactions need a replica set:
// MongoDB Atlas always is one. On a standalone development server the steps run one
// by one, as before.
let transactionsSupported = null;
const supportsTransactions = async () => {
  if (transactionsSupported === null) {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === "isdbgrid");
  }
  return transactionsSupported;
};
// work(session) runs inside one transaction (retried by MongoDB on a write conflict,
// e.g. two receipts taking the next number at the same moment). Its result is returned.
const inTransaction = async (work) => {
  if (!(await supportsTransactions())) return work(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

// --- Receipt numbers ---

const nextReceipt = async (day, session) => {
  const counter = await receiptCounterModel.findOneAndUpdate({ _id: day }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  const [y, m, d] = day.split("-");
  return { seq: counter.seq, receiptNo: `${d}${m}${y.slice(2)}-${String(counter.seq).padStart(4, "0")}` };
};

const alreadyPaid = (payment) =>
  new BillingError(
    `Already paid: receipt ${payment.receiptNo}${payment.collectedBy?.name ? ` by ${payment.collectedBy.name}` : ""}`,
    "already_paid",
    { payment }
  );

// --- What reception still has to collect ---

const testPrices = async (orders) => {
  const ids = [...new Set(orders.flatMap((o) => o.tests.map((t) => t.testId)).filter((id) => mongoose.isValidObjectId(id)))];
  const tests = ids.length ? await labTestModel.find({ _id: { $in: ids } }).select("price").lean() : [];
  return new Map(tests.map((t) => [String(t._id), typeof t.price === "number" ? t.price : null]));
};

const labItems = (order, prices) =>
  order.tests.map((t) => ({ testId: t.testId, label: t.name, price: prices.get(String(t.testId)) ?? null }));

// Consultations: today's patients who got a queue token (walk-in or checked in)
// and have no paid receipt. Lab: requests of the last 7 days that aren't
// cancelled or paid.
export const dueList = async () => {
  const day = hospitalSlotDate(new Date());
  const tokens = await queueTokenModel
    .find({ day, status: { $ne: "left" }, appointmentId: { $exists: true } })
    .select("appointmentId number docId patientName phone issuedAt")
    .sort({ issuedAt: 1 })
    .lean();
  const appointmentIds = tokens.map((t) => t.appointmentId);
  const [paid, appointments] = await Promise.all([
    paymentModel.find({ active: true, kind: "consultation", appointmentId: { $in: appointmentIds } }).select("appointmentId").lean(),
    appointmentModel.find({ _id: { $in: appointmentIds }, cancelled: { $ne: true } }).select("amount docData.name docId userId").lean(),
  ]);
  const paidIds = new Set(paid.map((p) => p.appointmentId));
  const byId = new Map(appointments.map((a) => [String(a._id), a]));
  const visits = tokens
    .filter((t) => !paidIds.has(t.appointmentId) && byId.has(t.appointmentId))
    .map((t) => {
      const a = byId.get(t.appointmentId);
      return {
        appointmentId: t.appointmentId,
        tokenNumber: t.number,
        patientName: t.patientName,
        phone: t.phone || "",
        docId: a.docId,
        doctorName: a.docData?.name || "",
        amount: a.amount ?? 0,
        issuedAt: t.issuedAt,
      };
    });

  const since = new Date(Date.now() - 7 * 86400000);
  const orders = await labOrderModel
    .find({ status: { $ne: "cancelled" }, createdAt: { $gte: since }, "payment.receiptNo": { $exists: false } })
    .select("orderNumber patient doctor docId tests createdAt urgent")
    .sort({ createdAt: 1 })
    .lean();
  const prices = await testPrices(orders);
  const lab = orders.map((o) => {
    const items = labItems(o, prices);
    return {
      labOrderId: String(o._id),
      orderNumber: o.orderNumber,
      patientName: o.patient?.name || "",
      phone: o.patient?.phone || "",
      docId: o.docId,
      doctorName: o.doctor?.name || "",
      urgent: o.urgent,
      items,
      // Unknown when a test has no price in the test list; reception enters it
      total: items.every((i) => typeof i.price === "number") ? items.reduce((s, i) => s + i.price, 0) : null,
      createdAt: o.createdAt,
    };
  });
  return { visits, lab };
};

// What one visit or lab order costs, for the Collect screen
export const dueFor = async ({ appointmentId, labOrderId }) => {
  if (appointmentId) {
    if (!mongoose.isValidObjectId(appointmentId)) throw new BillingError("Visit not found");
    const a = await appointmentModel.findById(appointmentId).select("amount docId docData.name userData.name userData.phone cancelled").lean();
    if (!a) throw new BillingError("Visit not found");
    const paid = await paymentModel.findOne({ active: true, kind: "consultation", appointmentId: String(a._id) }).lean();
    return {
      kind: "consultation",
      appointmentId: String(a._id),
      patientName: a.userData?.name || "",
      docId: a.docId,
      doctorName: a.docData?.name || "",
      amount: a.amount ?? 0,
      cancelled: Boolean(a.cancelled),
      paid: paid ? { receiptNo: paid.receiptNo, net: paid.net, by: paid.collectedBy?.name || "" } : null,
    };
  }
  if (!mongoose.isValidObjectId(labOrderId)) throw new BillingError("Lab request not found");
  const o = await labOrderModel.findById(labOrderId).lean();
  if (!o) throw new BillingError("Lab request not found");
  const items = labItems(o, await testPrices([o]));
  const paid = await paymentModel.findOne({ active: true, kind: "lab", labOrderId: String(o._id) }).lean();
  return {
    kind: "lab",
    labOrderId: String(o._id),
    orderNumber: o.orderNumber,
    patientName: o.patient?.name || "",
    docId: o.docId,
    doctorName: o.doctor?.name || "",
    items,
    cancelled: o.status === "cancelled",
    paid: paid ? { receiptNo: paid.receiptNo, net: paid.net, by: paid.collectedBy?.name || "" } : null,
  };
};

// --- Collect ---

const resolveDiscountDoctor = async (docId) => {
  if (!mongoose.isValidObjectId(docId)) throw new BillingError("Choose the doctor who allowed the discount");
  const doctor = await doctorModel.findById(docId).select("name").lean();
  if (!doctor) throw new BillingError("Choose the doctor who allowed the discount");
  return { docId: String(doctor._id), name: doctor.name };
};

// input: { appointmentId | labOrderId, items (lab: [{ label, amount }]), discount,
//          discountAllowedBy (doctor id), discountReason, method, reference,
//          counterId, requestId }
// by: { role: "admin" | "reception", name }
export const collect = async (input, by) => {
  const requestId = input.requestId ? cleanText(input.requestId, 80) : undefined;
  if (requestId) {
    const repeat = await paymentModel.findOne({ requestId }).lean();
    if (repeat) return { payment: repeat, repeated: true };
  }

  const method = String(input.method || "");
  if (!PAYMENT_METHODS.includes(method)) throw new BillingError("Choose cash or bank transfer");
  const counter = await findCounter(input.counterId);
  if (!counter.active) throw new BillingError("This counter is turned off. Choose another one.", "counter_required");

  let base;
  if (input.appointmentId) {
    if (!mongoose.isValidObjectId(input.appointmentId)) throw new BillingError("Visit not found");
    const a = await appointmentModel.findById(input.appointmentId).lean();
    if (!a) throw new BillingError("Visit not found");
    if (a.cancelled) throw new BillingError("This visit was cancelled, so nothing is due");
    const existing = await paymentModel.findOne({ active: true, kind: "consultation", appointmentId: String(a._id) }).lean();
    if (existing) throw alreadyPaid(existing);
    const gross = toRupees(a.amount ?? 0);
    base = {
      kind: "consultation",
      appointmentId: String(a._id),
      patient: { id: a.userId, name: a.userData?.name || "Patient", phone: a.userData?.phone || "" },
      docId: a.docId,
      doctorName: a.docData?.name || "",
      items: [{ label: `Consultation, Dr. ${a.docData?.name || ""}`.trim(), amount: gross }],
      gross,
      appointment: a,
    };
  } else if (input.labOrderId) {
    if (!mongoose.isValidObjectId(input.labOrderId)) throw new BillingError("Lab request not found");
    const o = await labOrderModel.findById(input.labOrderId).lean();
    if (!o) throw new BillingError("Lab request not found");
    if (o.status === "cancelled") throw new BillingError("This lab request was cancelled, so nothing is due");
    const existing = await paymentModel.findOne({ active: true, kind: "lab", labOrderId: String(o._id) }).lean();
    if (existing) throw alreadyPaid(existing);
    // One line per requested test; the amount comes from the screen (test prices
    // can be missing or differ from the list)
    const sent = Array.isArray(input.items) ? input.items : [];
    if (sent.length !== o.tests.length) throw new BillingError("Enter a price for every test");
    const items = o.tests.map((t, index) => {
      const amount = sent[index]?.amount;
      if (amount === "" || amount === null || amount === undefined || !validAmount(amount)) {
        throw new BillingError(`Enter the price of ${t.name}`);
      }
      return { label: t.name, amount: toRupees(amount) };
    });
    base = {
      kind: "lab",
      labOrderId: String(o._id),
      labOrderNumber: o.orderNumber,
      patient: { id: o.userId, name: o.patient?.name || "Patient", phone: o.patient?.phone || "" },
      docId: o.docId,
      doctorName: o.doctor?.name || "",
      items,
      gross: items.reduce((sum, i) => sum + i.amount, 0),
    };
  } else {
    throw new BillingError("Nothing to collect for");
  }

  const discount = input.discount === "" || input.discount == null ? 0 : Number(input.discount);
  if (!validAmount(discount)) throw new BillingError("Enter a valid discount");
  const discountRs = toRupees(discount);
  if (discountRs > base.gross) throw new BillingError("The discount can't be more than the amount");
  const discountAllowedBy = discountRs > 0 ? await resolveDiscountDoctor(input.discountAllowedBy) : undefined;
  const net = base.gross - discountRs;
  const day = todayIso();
  const { appointment, ...fields } = base;
  // The unique indexes are what stop two receipts for one visit. On a new database
  // they are still being built just after start; wait for them (instant afterwards)
  await paymentModel.init();

  // One transaction: the payment (the unique indexes decide who wins when two
  // receptionists collect for the same patient at once), its receipt number, the
  // lower fee after a discount and the lab order's paid mark. A refused or failed
  // attempt leaves nothing behind, not even a used receipt number.
  // The payment is saved with a temporary number first, then given the next one.
  let payment;
  try {
    payment = await inTransaction(async (session) => {
      const [created] = await paymentModel.create(
        [
          {
            ...fields,
            receiptNo: `pending-${new mongoose.Types.ObjectId()}`,
            day,
            seq: 0,
            discount: discountRs,
            net,
            ...(discountAllowedBy && { discountAllowedBy, discountReason: cleanText(input.discountReason) }),
            method,
            reference: method === "bank_transfer" ? cleanText(input.reference, 80) : "",
            counterId: counter.id,
            counterName: counter.name,
            collectedBy: { role: by.role, name: cleanText(by.name, 40) },
            ...(requestId && { requestId }),
          },
        ],
        { session }
      );
      const { seq, receiptNo } = await nextReceipt(day, session);
      const saved = await paymentModel.findByIdAndUpdate(created._id, { $set: { receiptNo, seq } }, { new: true, session });

      // A discount lowers what the visit earned. Only if the fee is still the one we
      // charged on (nobody changed it meanwhile). A visit already completed keeps its
      // hospital share percent, recalculated on the lower amount.
      if (appointment && discountRs > 0) {
        const share = appointment.share && typeof appointment.share.percent === "number" ? splitFee(net, appointment.share.percent) : null;
        await appointmentModel.updateOne(
          { _id: appointment._id, amount: appointment.amount },
          { $set: { amount: net, finalFee: net, ...(share && { share }) } },
          { session }
        );
      }
      if (fields.kind === "lab") {
        await labOrderModel.updateOne(
          { _id: fields.labOrderId },
          { $set: { payment: { receiptNo, net, paidAt: saved.collectedAt } } },
          { session }
        );
      }
      return saved;
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    // Someone else collected for the same visit / lab order at the same moment,
    // or this exact request was already saved
    if (requestId) {
      const repeat = await paymentModel.findOne({ requestId }).lean();
      if (repeat) return { payment: repeat, repeated: true };
    }
    const other = await paymentModel
      .findOne({ active: true, ...(fields.kind === "lab" ? { kind: "lab", labOrderId: fields.labOrderId } : { kind: "consultation", appointmentId: fields.appointmentId }) })
      .lean();
    if (other) throw alreadyPaid(other);
    throw error;
  }
  return { payment: payment.toObject(), repeated: false };
};

// --- Refund (owner only) ---

export const refund = async ({ paymentId, amount, reason, counterId }, by) => {
  if (!mongoose.isValidObjectId(paymentId)) throw new BillingError("Receipt not found");
  const text = cleanText(reason);
  if (!text) throw new BillingError("Enter the reason for the refund");
  if (!validAmount(amount) || toRupees(amount) < 1) throw new BillingError("Enter the amount to refund");
  const rupees = toRupees(amount);
  const payment = await paymentModel.findById(paymentId).lean();
  if (!payment) throw new BillingError("Receipt not found");
  const counter = await findCounter(counterId || payment.counterId);

  // One transaction: the refunded amount, the receipt's status, the refund record
  // (which the counter close counts) and, after a full lab refund, the lab order back
  // to unpaid. A failure halfway leaves the receipt as it was.
  const { record, updated, full } = await inTransaction(async (session) => {
    // Only if this doesn't refund more than was paid, even with two refunds at once
    const updated = await paymentModel.findOneAndUpdate(
      { _id: payment._id, $expr: { $lte: [{ $add: ["$refunded", rupees] }, "$net"] } },
      { $inc: { refunded: rupees } },
      { new: true, session }
    );
    if (!updated) {
      const left = payment.net - payment.refunded;
      throw new BillingError(left > 0 ? `At most Rs ${left} can still be refunded` : "This receipt was already refunded in full");
    }
    const full = updated.refunded >= updated.net;
    await paymentModel.updateOne(
      { _id: updated._id },
      { $set: { status: full ? "refunded" : "partly_refunded", ...(full && { active: false }) } },
      { session }
    );
    const [record] = await refundModel.create(
      [
        {
          paymentId: String(payment._id),
          receiptNo: payment.receiptNo,
          amount: rupees,
          method: payment.method,
          reason: text,
          counterId: counter.id,
          counterName: counter.name,
          by: { role: by.role, name: cleanText(by.name, 40) },
        },
      ],
      { session }
    );
    if (full && payment.kind === "lab") {
      await labOrderModel.updateOne(
        { _id: payment.labOrderId, "payment.receiptNo": payment.receiptNo },
        { $unset: { payment: 1 } },
        { session }
      );
    }
    return { record, updated, full };
  });
  return { refund: record.toObject(), payment: { ...updated.toObject(), status: full ? "refunded" : "partly_refunded", active: !full } };
};

// --- Receipts ---

export const receipts = async ({ from, to, counterId, q }) => {
  const range = parseRange(from, to);
  const filter = { collectedAt: { $gte: range.start, $lt: range.end } };
  if (counterId) filter.counterId = String(counterId);
  const text = cleanText(q, 40);
  if (text) {
    const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ receiptNo: pattern }, { "patient.name": pattern }, { "patient.phone": pattern }];
  }
  return paymentModel.find(filter).sort({ collectedAt: -1 }).limit(500).lean();
};

// --- Closing a counter ---

const sumBy = (rows, method) => rows.filter((r) => !method || r.method === method).reduce((s, r) => s + (r.amount ?? r.net), 0);

// What the drawer should hold right now: everything of this counter not yet counted
export const closePreview = async (counterId) => {
  const counter = await findCounter(counterId);
  const [payments, refunds, last] = await Promise.all([
    paymentModel.find({ counterId: counter.id, closeId: null }).select("net method").lean(),
    refundModel.find({ counterId: counter.id, closeId: null }).select("amount method").lean(),
    cashCloseModel.findOne({ counterId: counter.id }).sort({ closedAt: -1 }).select("closedAt").lean(),
  ]);
  const cashIn = sumBy(payments, "cash");
  const cashRefunds = sumBy(refunds, "cash");
  return {
    counter,
    from: last?.closedAt || null,
    receipts: payments.length,
    cashIn,
    cashRefunds,
    expected: cashIn - cashRefunds,
    bankTransfers: sumBy(payments, "bank_transfer") - sumBy(refunds, "bank_transfer"),
  };
};

// Counts the drawer. Each payment/refund is marked with this close in one atomic
// step per document, so a payment saved at the same moment either belongs to
// this close or to the next one, never to both or neither.
export const closeCounter = async ({ counterId, countedCash, notes, note, requestId }, by) => {
  // The same request again (double click, retry after a slow network): the close it made
  const requestKey = requestId ? cleanText(requestId, 80) : undefined;
  if (requestKey) {
    const repeat = await cashCloseModel.findOne({ requestId: requestKey }).lean();
    if (repeat) return repeat;
  }
  await cashCloseModel.init(); // the unique request id index exists before the first close
  const counter = await findCounter(counterId);
  if (!validAmount(countedCash) || countedCash === "" || countedCash === null) {
    throw new BillingError("Enter the cash you counted in the drawer");
  }
  const counted = toRupees(countedCash);
  const text = cleanText(note, 300);
  const closeId = new mongoose.Types.ObjectId();
  const id = String(closeId);
  const last = await cashCloseModel.findOne({ counterId: counter.id }).sort({ closedAt: -1 }).select("closedAt").lean();

  await paymentModel.updateMany({ counterId: counter.id, closeId: null }, { $set: { closeId: id } });
  await refundModel.updateMany({ counterId: counter.id, closeId: null }, { $set: { closeId: id } });
  const undo = async () => {
    await paymentModel.updateMany({ closeId: id }, { $set: { closeId: null } });
    await refundModel.updateMany({ closeId: id }, { $set: { closeId: null } });
  };

  try {
    const [payments, refunds] = await Promise.all([
      paymentModel.find({ closeId: id }).select("net method").lean(),
      refundModel.find({ closeId: id }).select("amount method").lean(),
    ]);
    const cashIn = sumBy(payments, "cash");
    const cashRefunds = sumBy(refunds, "cash");
    const expected = cashIn - cashRefunds;
    const difference = counted - expected;
    if (difference !== 0 && !text) {
      await undo();
      throw new BillingError(
        `The drawer should have Rs ${expected}. Write a note to explain the difference of Rs ${Math.abs(difference)}.`,
        "note_required",
        { expected }
      );
    }
    const cleanNotes =
      notes && typeof notes === "object"
        ? Object.fromEntries(
            Object.entries(notes)
              .filter(([k, v]) => /^\d{1,5}$/.test(k) && Number.isInteger(Number(v)) && Number(v) > 0)
              .map(([k, v]) => [k, Number(v)])
          )
        : undefined;
    const close = await cashCloseModel.create({
      _id: closeId,
      counterId: counter.id,
      counterName: counter.name,
      from: last?.closedAt,
      closedBy: { role: by.role, name: cleanText(by.name, 40) },
      cashIn,
      cashRefunds,
      expected,
      bankTransfers: sumBy(payments, "bank_transfer") - sumBy(refunds, "bank_transfer"),
      receipts: payments.length,
      countedCash: counted,
      ...(cleanNotes && Object.keys(cleanNotes).length && { notes: cleanNotes }),
      difference,
      note: text,
      ...(requestKey && { requestId: requestKey }),
    });
    return close.toObject();
  } catch (error) {
    if (!(error instanceof BillingError)) await undo().catch(() => {});
    // The same request arrived twice at once: the other one saved the close
    if (isDuplicate(error) && requestKey) {
      const repeat = await cashCloseModel.findOne({ requestId: requestKey }).lean();
      if (repeat) return repeat;
    }
    throw error;
  }
};

export const verifyClose = async (closeId, by) => {
  if (!mongoose.isValidObjectId(closeId)) throw new BillingError("Close not found");
  const close = await cashCloseModel.findOneAndUpdate(
    { _id: closeId, verifiedAt: { $exists: false } },
    { $set: { verifiedAt: new Date(), verifiedBy: { role: by.role, name: cleanText(by.name, 40) } } },
    { new: true }
  );
  if (!close) {
    const exists = await cashCloseModel.exists({ _id: closeId });
    throw new BillingError(exists ? "Already verified" : "Close not found");
  }
  return close.toObject();
};

// --- Owner's "Money" screen ---

export const summary = async ({ from, to }) => {
  const range = parseRange(from, to);
  const [payments, refunds, closes, settings] = await Promise.all([
    paymentModel.find({ collectedAt: { $gte: range.start, $lt: range.end } }).sort({ collectedAt: 1 }).lean(),
    refundModel.find({ at: { $gte: range.start, $lt: range.end } }).sort({ at: 1 }).lean(),
    cashCloseModel.find({ closedAt: { $gte: range.start, $lt: range.end } }).sort({ closedAt: -1 }).lean(),
    getSettings(),
  ]);

  const kept = (p) => p.net - (p.refunded || 0); // what the hospital keeps from a receipt
  const totals = {
    receipts: payments.length,
    gross: payments.reduce((s, p) => s + p.gross, 0),
    discounts: payments.reduce((s, p) => s + (p.discount || 0), 0),
    collected: payments.reduce((s, p) => s + p.net, 0),
    refunds: refunds.reduce((s, r) => s + r.amount, 0),
    cash: sumBy(payments, "cash") - sumBy(refunds, "cash"),
    bankTransfer: sumBy(payments, "bank_transfer") - sumBy(refunds, "bank_transfer"),
    consultation: payments.filter((p) => p.kind === "consultation").reduce((s, p) => s + kept(p), 0),
    lab: payments.filter((p) => p.kind === "lab").reduce((s, p) => s + kept(p), 0),
  };
  totals.net = totals.collected - totals.refunds;

  // Per counter: money in and out, and its closes in the period
  const counterIds = new Set([...settings.counters.map((c) => c.id), ...payments.map((p) => p.counterId)]);
  const counterName = (id) => settings.counters.find((c) => c.id === id)?.name || payments.find((p) => p.counterId === id)?.counterName || "Counter";
  const [openPayments, openRefunds] = await Promise.all([
    paymentModel.find({ closeId: null }).select("counterId net method").lean(),
    refundModel.find({ closeId: null }).select("counterId amount method").lean(),
  ]);
  const byCounter = [...counterIds]
    .map((id) => {
      const mine = payments.filter((p) => p.counterId === id);
      const myRefunds = refunds.filter((r) => r.counterId === id);
      const myCloses = closes.filter((c) => c.counterId === id);
      const notCounted =
        sumBy(openPayments.filter((p) => p.counterId === id), "cash") - sumBy(openRefunds.filter((r) => r.counterId === id), "cash");
      return {
        counterId: id,
        name: counterName(id),
        receipts: mine.length,
        cash: sumBy(mine, "cash"),
        bankTransfer: sumBy(mine, "bank_transfer"),
        refunds: myRefunds.reduce((s, r) => s + r.amount, 0),
        closes: myCloses.length,
        difference: myCloses.reduce((s, c) => s + c.difference, 0),
        unverified: myCloses.filter((c) => !c.verifiedAt).length,
        notCountedCash: notCounted, // cash taken since this counter's last close
      };
    })
    .filter((c) => c.receipts || c.refunds || c.closes || c.notCountedCash);

  // Per person at the counter (the name picked on the computer)
  const staffMap = new Map();
  for (const p of payments) {
    const key = p.collectedBy?.name || (p.collectedBy?.role === "admin" ? "Owner" : "Reception");
    const row = staffMap.get(key) || { name: key, receipts: 0, collected: 0 };
    row.receipts += 1;
    row.collected += p.net;
    staffMap.set(key, row);
  }

  // Per doctor: consultation money and the hospital/doctor split. A completed visit
  // uses its saved split; one not completed yet uses the doctor's current share.
  const consultations = payments.filter((p) => p.kind === "consultation");
  const appointments = await appointmentModel
    .find({ _id: { $in: consultations.map((p) => p.appointmentId) } })
    .select("share")
    .lean();
  const shareOf = new Map(appointments.map((a) => [String(a._id), a.share]));
  const docIds = [...new Set(payments.map((p) => p.docId).filter(Boolean))];
  const doctors = await doctorModel.find({ _id: { $in: docIds.filter((id) => mongoose.isValidObjectId(id)) } }).select("name hospitalSharePercent").lean();
  const percentOf = new Map(doctors.map((d) => [String(d._id), d.hospitalSharePercent ?? 0]));
  const doctorMap = new Map();
  const doctorRow = (docId, name) => {
    const row = doctorMap.get(docId) || {
      docId,
      name: name || doctors.find((d) => String(d._id) === docId)?.name || "",
      visits: 0,
      consultation: 0,
      lab: 0,
      discountsAllowed: 0,
      hospitalShare: 0,
      doctorShare: 0,
    };
    doctorMap.set(docId, row);
    return row;
  };
  for (const p of payments) {
    if (!p.docId) continue;
    const row = doctorRow(p.docId, p.doctorName);
    if (p.kind === "lab") {
      row.lab += kept(p);
      continue;
    }
    row.visits += 1;
    row.consultation += kept(p);
    const saved = shareOf.get(p.appointmentId);
    const percent = saved && typeof saved.percent === "number" ? saved.percent : percentOf.get(p.docId) ?? 0;
    const split = splitFee(kept(p), percent);
    row.hospitalShare += split.hospital;
    row.doctorShare += split.doctor;
  }
  for (const p of payments) {
    if (p.discount > 0 && p.discountAllowedBy?.docId) doctorRow(p.discountAllowedBy.docId, p.discountAllowedBy.name).discountsAllowed += p.discount;
  }

  const includesToday = range.from <= todayIso() && todayIso() <= range.to;
  const due = includesToday ? await dueList() : null;

  // Receipt numbers that were given out but have no receipt (should be rare)
  const days = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  const counters = await receiptCounterModel.find({ _id: { $in: days } }).lean();
  const seqDocs = await paymentModel.find({ day: { $in: days } }).select("day seq").lean();
  const gaps = counters.flatMap((c) => {
    const have = new Set(seqDocs.filter((p) => p.day === c._id).map((p) => p.seq));
    const missing = [];
    for (let n = 1; n <= c.seq; n++) if (!have.has(n)) missing.push(n);
    return missing.length ? [{ day: c._id, numbers: missing }] : [];
  });

  return {
    from: range.from,
    to: range.to,
    totals,
    byCounter,
    byStaff: [...staffMap.values()].sort((a, b) => b.collected - a.collected),
    byDoctor: [...doctorMap.values()].sort((a, b) => b.consultation + b.lab - (a.consultation + a.lab)),
    discounts: payments
      .filter((p) => p.discount > 0)
      .map((p) => ({
        receiptNo: p.receiptNo,
        patientName: p.patient?.name,
        amount: p.discount,
        allowedBy: p.discountAllowedBy?.name || "",
        reason: p.discountReason || "",
        collectedBy: p.collectedBy?.name || "",
        at: p.collectedAt,
      })),
    refunds,
    closes,
    unpaid: due ? { visits: due.visits, lab: due.lab } : null,
    receiptGaps: gaps,
  };
};
