// The pharmacy's prescription queue: what the hospital's doctors sent, oldest
// waiting first. Dispensing happens at the counter (the sale says which
// prescription and which of its lines each bill line is for, saleService);
// a prescription the patient didn't buy is closed with a note.
import mongoose from "mongoose";
import { prescriptionModel, rxStatusAfter } from "../models/prescriptionModel.js";
import { PharmacyError, notFound } from "../http.js";

const OPEN = ["waiting", "partly"];

export const listPrescriptions = async ({ status = "open", q, limit = 50, cursor }) => {
  const filter = status === "open" ? { status: { $in: OPEN } } : status === "all" ? {} : { status };
  const text = String(q || "").trim().slice(0, 60);
  if (text) {
    const rx = /^\d+$/.test(text) ? [{ rxNo: Number(text) }] : [];
    filter.$or = [...rx, { "patient.name": new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }];
  }
  const size = Math.min(200, limit);
  // Open ones oldest first (the queue); the rest newest first
  const queue = status === "open";
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const cmp = queue ? "$gt" : "$lt";
  const page = after
    ? { $and: [filter, { $or: [{ createdAt: { [cmp]: new Date(Number(after[0])) } }, { createdAt: new Date(Number(after[0])), _id: { [cmp]: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const order = queue ? 1 : -1;
  const rows = await prescriptionModel.find(page).sort({ createdAt: order, _id: order }).limit(size + 1).lean();
  const items = rows.slice(0, size);
  return { prescriptions: items, nextCursor: rows.length > size ? `${items.at(-1).createdAt.getTime()}_${items.at(-1)._id}` : null };
};

export const openCount = () => prescriptionModel.countDocuments({ status: { $in: OPEN } });

export const getPrescription = async (id) => {
  const rx = await prescriptionModel.findById(id).lean();
  if (!rx) throw notFound("Prescription");
  return rx;
};

// The patient didn't buy (or bought only part): close it so it leaves the queue
export const closePrescription = async (id, { note }, actor) => {
  const rx = await prescriptionModel.findOneAndUpdate({ _id: id, status: { $in: OPEN } }, { $set: { status: "closed", closedNote: note, closedBy: actor } }, { new: true }).lean();
  if (!rx) {
    if (!(await prescriptionModel.exists({ _id: id }))) throw notFound("Prescription");
    throw new PharmacyError("This prescription isn't open any more", { status: 409, code: "rx_not_open" });
  }
  return rx;
};

// Inside a sale's save: count what this bill sold against the prescription's lines
// (each bill line may say which prescription line it is for: the prescribed item,
// a substitute, or what the pharmacist chose for a written-in medicine)
export const dispenseAgainst = async ({ prescriptionId, lines, sale }, session) => {
  const rx = await prescriptionModel.findOne({ _id: prescriptionId, status: { $in: OPEN } }).session(session || null).lean();
  if (!rx) throw new PharmacyError("This prescription isn't open any more", { status: 409, code: "rx_not_open" });
  const inc = {};
  for (const l of lines) {
    if (Number.isInteger(l.rxLine) && l.rxLine >= 0 && l.rxLine < rx.items.length) inc[`items.${l.rxLine}.dispensedUnits`] = (inc[`items.${l.rxLine}.dispensedUnits`] || 0) + l.qtyUnits;
  }
  // Only while still open (two counters dispensing the same prescription: both count, neither lost)
  const updated = await prescriptionModel
    .findOneAndUpdate(
      { _id: prescriptionId, status: { $in: OPEN } },
      { ...(Object.keys(inc).length && { $inc: inc }), $push: { sales: { saleId: String(sale._id), saleNo: sale.saleNo, at: new Date() } } },
      { new: true, session }
    )
    .lean();
  if (!updated) throw new PharmacyError("This prescription isn't open any more", { status: 409, code: "rx_not_open" });
  const status = rxStatusAfter(updated.items);
  await prescriptionModel.updateOne({ _id: prescriptionId }, { $set: { status, ...(status === "dispensed" && { dispensedAt: new Date() }) } }, { session });
  return { rxNo: updated.rxNo, status };
};

// Development databases without transactions only: a failed sale's counts reversed
export const undoDispense = async ({ prescriptionId, lines, saleId }) => {
  const inc = {};
  for (const l of lines) if (Number.isInteger(l.rxLine)) inc[`items.${l.rxLine}.dispensedUnits`] = (inc[`items.${l.rxLine}.dispensedUnits`] || 0) - l.qtyUnits;
  const rx = await prescriptionModel.findOneAndUpdate(
    { _id: prescriptionId, "sales.saleId": String(saleId) },
    { ...(Object.keys(inc).length && { $inc: inc }), $pull: { sales: { saleId: String(saleId) } } },
    { new: true }
  ).lean();
  if (rx) await prescriptionModel.updateOne({ _id: prescriptionId }, { $set: { status: rxStatusAfter(rx.items) }, $unset: { dispensedAt: "" } });
};
