// Khata. Customers: a bill can go on a customer's account (all of it, or what is
// left after cash paid now), within their credit limit; they pay it off later at
// any counter. Every change is an entry, and the balance moves with it in the same
// save, so the balance always equals the entries.
//
// Suppliers: what is owed = purchases (total - paid at the time) - payments since,
// worked out from the documents when asked.
import mongoose from "mongoose";
import { customerModel, customerEntryModel, supplierPaymentModel } from "../models/khataModels.js";
import { supplierModel, purchaseModel } from "../models/purchaseModels.js";
import { requireShift, touchShift, openShiftOf } from "./shiftService.js";
import { PharmacyError, notFound } from "../http.js";
import { can } from "../permissions.js";
import { inTransaction, isDuplicateKey } from "../../../lib/transactions.js";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const publicCustomer = (c) => ({
  _id: String(c._id),
  name: c.name,
  phone: c.phone,
  address: c.address,
  notes: c.notes,
  creditLimitPaisa: c.creditLimitPaisa ?? null,
  balancePaisa: c.balancePaisa,
  active: c.active,
});

// --- Customers ---
export const listCustomers = async ({ q, owing, limit = 50 }) => {
  const filter = {};
  const text = String(q || "").trim().toLowerCase().slice(0, 60);
  if (text) {
    const digits = text.replace(/\D/g, "");
    filter.$or = [{ nameKey: new RegExp(`^${escapeRegex(text)}`) }, ...(digits.length >= 3 ? [{ phoneKey: new RegExp(escapeRegex(digits)) }] : [])];
  }
  if (owing) filter.balancePaisa = { $gt: 0 };
  const rows = await customerModel.find(filter).sort(owing ? { balancePaisa: -1 } : { nameKey: 1 }).limit(Math.min(500, limit)).lean();
  const [owed] = owing || !text ? await customerModel.aggregate([{ $match: { balancePaisa: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: "$balancePaisa" }, count: { $sum: 1 } } }]) : [];
  return { customers: rows.map(publicCustomer), ...(owed !== undefined && { owed: { totalPaisa: owed?.total || 0, customers: owed?.count || 0 } }) };
};

// Anyone at the counter may add a customer; only managers set or change the credit limit
export const createCustomer = async (input, actor) => {
  const { creditLimitPaisa, ...rest } = input;
  if (creditLimitPaisa !== undefined && !can(actor, "manageCredit")) {
    throw new PharmacyError("Only the manager sets credit limits", { status: 403, code: "forbidden" });
  }
  return publicCustomer((await customerModel.create({ ...rest, ...(creditLimitPaisa !== undefined && creditLimitPaisa !== null && { creditLimitPaisa }) })).toObject());
};

export const updateCustomer = async (id, input, actor) => {
  if ("creditLimitPaisa" in input && !can(actor, "manageCredit")) {
    throw new PharmacyError("Only the manager sets credit limits", { status: 403, code: "forbidden" });
  }
  const customer = await customerModel.findById(id);
  if (!customer) throw notFound("Customer");
  const { creditLimitPaisa, ...rest } = input;
  customer.set(rest);
  if ("creditLimitPaisa" in input) customer.creditLimitPaisa = creditLimitPaisa ?? undefined;
  await customer.save(); // never the balance: that moves only with entries
  return publicCustomer(customer.toObject());
};

export const getCustomer = async (id) => {
  const customer = await customerModel.findById(id).lean();
  if (!customer) throw notFound("Customer");
  return publicCustomer(customer);
};

// The account, newest first, a page at a time
export const statement = async (customerId, { limit = 50, cursor }) => {
  const size = Math.min(200, limit);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const filter = { customerId: String(customerId) };
  const page = after
    ? { $and: [filter, { $or: [{ at: { $lt: new Date(Number(after[0])) } }, { at: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await customerEntryModel.find(page).sort({ at: -1, _id: -1 }).limit(size + 1).lean();
  const items = rows.slice(0, size);
  return { entries: items, nextCursor: rows.length > size ? `${items.at(-1).at.getTime()}_${items.at(-1)._id}` : null };
};

// Put an amount on a customer's khata (inside the sale's save). Within the credit
// limit unless allowed to go over; one conditional update, so two counters can't
// together push a customer past their limit.
export const chargeAccount = async ({ customerId, amountPaisa, ref, by, overLimit }, session) => {
  const limitCheck = overLimit ? {} : { $or: [{ creditLimitPaisa: null }, { $expr: { $lte: [{ $add: ["$balancePaisa", amountPaisa] }, "$creditLimitPaisa"] } }] };
  const customer = await customerModel.findOneAndUpdate({ _id: customerId, active: true, ...limitCheck }, { $inc: { balancePaisa: amountPaisa } }, { new: true, session }).lean();
  if (!customer) {
    const current = await customerModel.findById(customerId).session(session || null).lean();
    if (!current || !current.active) throw notFound("Customer");
    const room = Math.max(0, (current.creditLimitPaisa ?? 0) - current.balancePaisa);
    throw new PharmacyError(`${current.name}'s credit limit would be passed (room left: Rs ${(room / 100).toLocaleString("en-PK")})`, {
      status: 409,
      code: "credit_limit",
      extra: { balancePaisa: current.balancePaisa, creditLimitPaisa: current.creditLimitPaisa, roomPaisa: room },
    });
  }
  await customerEntryModel.create([{ customerId: String(customerId), type: "sale", amountPaisa, balanceAfterPaisa: customer.balancePaisa, ref, by }], { session });
  return customer;
};

// Take an amount off a customer's khata: a return of an account bill
export const creditAccount = async ({ customerId, amountPaisa, ref, by }, session) => {
  const customer = await customerModel.findOneAndUpdate({ _id: customerId }, { $inc: { balancePaisa: -amountPaisa } }, { new: true, session }).lean();
  if (!customer) throw notFound("Customer");
  await customerEntryModel.create([{ customerId: String(customerId), type: "return", amountPaisa: -amountPaisa, balanceAfterPaisa: customer.balancePaisa, ref, by }], { session });
  return customer;
};

// A customer pays their khata at a counter. Needs the payer's open shift: cash
// counts in that drawer at closing. Paying more than owed leaves an advance.
export const receivePayment = async (customerId, { amountPaisa, method, note, requestId }, actor) => {
  if (requestId) {
    const repeat = await customerEntryModel.findOne({ requestId }).lean();
    if (repeat) return { entry: repeat, customer: await getCustomer(customerId), repeated: true };
  }
  const shift = await requireShift(actor);
  if (!(await customerModel.exists({ _id: customerId }))) throw notFound("Customer");
  await customerEntryModel.init();
  try {
    const entry = await inTransaction(async (session) => {
      await touchShift(shift._id, session);
      const _id = new mongoose.Types.ObjectId();
      // The entry first: its unique request id stops a double submit before the balance moves
      await customerEntryModel.create(
        [{ _id, customerId: String(customerId), type: "payment", amountPaisa: -amountPaisa, balanceAfterPaisa: 0, method, shiftId: String(shift._id), note, by: actor, ...(requestId && { requestId }) }],
        { session }
      );
      const customer = await customerModel.findByIdAndUpdate(customerId, { $inc: { balancePaisa: -amountPaisa } }, { new: true, session }).lean();
      return customerEntryModel.findByIdAndUpdate(_id, { $set: { balanceAfterPaisa: customer.balancePaisa } }, { new: true, session }).lean();
    });
    return { entry, customer: await getCustomer(customerId), repeated: false };
  } catch (error) {
    if (isDuplicateKey(error) && requestId) {
      const repeat = await customerEntryModel.findOne({ requestId }).lean();
      if (repeat) return { entry: repeat, customer: await getCustomer(customerId), repeated: true };
    }
    throw error;
  }
};

// --- Suppliers ---
const supplierBalances = async (supplierIds) => {
  const match = supplierIds ? { supplierId: { $in: supplierIds.map(String) } } : {};
  const [bought, paid] = await Promise.all([
    purchaseModel.aggregate([{ $match: match }, { $group: { _id: "$supplierId", owed: { $sum: { $subtract: ["$totalPaisa", "$paidPaisa"] } }, purchases: { $sum: 1 } } }]),
    supplierPaymentModel.aggregate([{ $match: match }, { $group: { _id: "$supplierId", paid: { $sum: "$amountPaisa" } } }]),
  ]);
  const out = new Map();
  for (const b of bought) out.set(b._id, { balancePaisa: b.owed, purchases: b.purchases });
  for (const p of paid) out.set(p._id, { purchases: 0, ...out.get(p._id), balancePaisa: (out.get(p._id)?.balancePaisa || 0) - p.paid });
  return out;
};

export const suppliersWithBalances = async (suppliers) => {
  const balances = await supplierBalances(suppliers.map((s) => s._id));
  return suppliers.map((s) => ({ ...s, balancePaisa: balances.get(String(s._id))?.balancePaisa || 0 }));
};

// A supplier's account, oldest first, with the running balance
export const supplierStatement = async (supplierId) => {
  const supplier = await supplierModel.findById(supplierId).lean();
  if (!supplier) throw notFound("Supplier");
  const [purchases, payments] = await Promise.all([
    purchaseModel.find({ supplierId: String(supplierId) }).select("purchaseNo invoiceNo invoiceDate totalPaisa paidPaisa createdAt").lean(),
    supplierPaymentModel.find({ supplierId: String(supplierId) }).lean(),
  ]);
  const lines = [
    ...purchases.map((p) => ({ at: p.createdAt, kind: "purchase", id: String(p._id), no: p.purchaseNo, invoiceNo: p.invoiceNo, totalPaisa: p.totalPaisa, paidPaisa: p.paidPaisa, changePaisa: p.totalPaisa - p.paidPaisa })),
    ...payments.map((p) => ({ at: p.createdAt, kind: "payment", id: String(p._id), method: p.method, reference: p.reference, note: p.note, paidOn: p.paidOn, fromDrawer: p.fromDrawer, by: p.by?.name, amountPaisa: p.amountPaisa, changePaisa: -p.amountPaisa })),
  ].sort((a, b) => a.at - b.at);
  let balance = 0;
  for (const line of lines) line.balancePaisa = balance += line.changePaisa;
  return { supplier: { _id: String(supplier._id), name: supplier.name, phone: supplier.phone }, balancePaisa: balance, lines };
};

export const paySupplier = async (supplierId, { amountPaisa, method, reference, note, paidOn, fromDrawer, requestId }, actor) => {
  if (requestId) {
    const repeat = await supplierPaymentModel.findOne({ requestId }).lean();
    if (repeat) return { payment: repeat, repeated: true };
  }
  if (!(await supplierModel.exists({ _id: supplierId }))) throw notFound("Supplier");
  if (fromDrawer && method !== "cash") throw new PharmacyError("Only cash comes out of the drawer", { code: "invalid" });
  const shift = fromDrawer ? await requireShift(actor) : await openShiftOf(actor);
  await supplierPaymentModel.init();
  try {
    const payment = await inTransaction(async (session) => {
      if (fromDrawer) await touchShift(shift._id, session);
      const [saved] = await supplierPaymentModel.create(
        [{ supplierId: String(supplierId), amountPaisa, method, reference, note, ...(paidOn && { paidOn }), fromDrawer: Boolean(fromDrawer), ...(fromDrawer && { shiftId: String(shift._id) }), by: actor, ...(requestId && { requestId }) }],
        { session }
      );
      return saved.toObject();
    });
    return { payment, repeated: false };
  } catch (error) {
    if (isDuplicateKey(error) && requestId) {
      const repeat = await supplierPaymentModel.findOne({ requestId }).lean();
      if (repeat) return { payment: repeat, repeated: true };
    }
    throw error;
  }
};

// --- Development databases without transactions only ---
// A sale or return that failed halfway: its khata entries are reversed by hand.
export const undoAccount = async (refId) => {
  const entries = await customerEntryModel.find({ "ref.id": String(refId) }).lean();
  for (const e of entries) await customerModel.updateOne({ _id: e.customerId }, { $inc: { balancePaisa: -e.amountPaisa } });
  await customerEntryModel.deleteMany({ "ref.id": String(refId) });
};
