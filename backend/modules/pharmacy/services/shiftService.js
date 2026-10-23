// Shifts: each person at the counter opens a shift with the cash in the drawer and
// closes it by counting the cash. The difference from what should be there (opening
// + cash in - cash out, see shiftTotals) is recorded, so a short drawer shows up the
// same day.
import mongoose from "mongoose";
import { shiftModel, saleModel, returnModel, actorKey } from "../models/salesModels.js";
import { customerEntryModel, supplierPaymentModel } from "../models/khataModels.js";
import { nextNumber } from "../models/stockModels.js";
import { PharmacyError, notFound } from "../http.js";
import { isDuplicateKey } from "../../../lib/transactions.js";
import { can } from "../permissions.js";

const noShift = () => new PharmacyError("Open your shift first", { status: 409, code: "no_shift" });

export const openShiftOf = (actor) => shiftModel.findOne({ actorKey: actorKey(actor), status: "open" }).lean();

// The open shift of this person, or a 409 the staff app answers with "Open shift"
export const requireShift = async (actor) => {
  const shift = await openShiftOf(actor);
  if (!shift) throw noShift();
  return shift;
};

// Everything that went through one shift, and the cash it moved through the drawer:
//   in:  cash bills, cash paid now on account bills, customers paying their khata in cash
//   out: cash refunds, suppliers paid from the drawer
export const shiftTotals = async (shiftId) => {
  const id = String(shiftId);
  const [sales, returns, receipts, paidOut] = await Promise.all([
    saleModel.aggregate([
      { $match: { shiftId: id } },
      {
        $group: {
          _id: "$paymentMethod",
          count: { $sum: 1 },
          total: { $sum: "$totalPaisa" },
          discount: { $sum: "$discountPaisa" },
          cost: { $sum: "$costPaisa" },
          cashNow: { $sum: "$cashReceivedPaisa" },
          onAccount: { $sum: "$onAccountPaisa" },
        },
      },
    ]),
    returnModel.aggregate([
      { $match: { shiftId: id } },
      { $group: { _id: { $ifNull: ["$refundTo", "cash"] }, count: { $sum: 1 }, total: { $sum: "$totalRefundPaisa" }, cost: { $sum: "$costPaisa" } } },
    ]),
    customerEntryModel.aggregate([{ $match: { shiftId: id, type: "payment" } }, { $group: { _id: "$method", total: { $sum: { $multiply: ["$amountPaisa", -1] } } } }]),
    supplierPaymentModel.aggregate([{ $match: { shiftId: id, fromDrawer: true } }, { $group: { _id: null, total: { $sum: "$amountPaisa" } } }]),
  ]);
  const by = Object.fromEntries(sales.map((x) => [x._id, x]));
  const back = Object.fromEntries(returns.map((x) => [x._id, x]));
  const got = Object.fromEntries(receipts.map((x) => [x._id, x.total]));
  const salesPaisa = sales.reduce((sum, x) => sum + x.total, 0);
  const refundsPaisa = back.cash?.total || 0;
  const accountReturnsPaisa = back.account?.total || 0;
  const cashSalesPaisa = (by.cash?.total || 0) + (by.account?.cashNow || 0);
  const khataCashPaisa = got.cash || 0;
  const supplierPaidPaisa = paidOut[0]?.total || 0;
  const returnCost = returns.reduce((sum, x) => sum + x.cost, 0);
  return {
    salesCount: sales.reduce((sum, x) => sum + x.count, 0),
    salesPaisa,
    cashSalesPaisa,
    cardSalesPaisa: by.card?.total || 0,
    onlineSalesPaisa: by.online?.total || 0,
    onAccountPaisa: by.account?.onAccount || 0,
    discountPaisa: sales.reduce((sum, x) => sum + x.discount, 0),
    returnsCount: returns.reduce((sum, x) => sum + x.count, 0),
    refundsPaisa, // paid back in cash
    accountReturnsPaisa, // taken off a khata
    khataCashPaisa,
    khataCardPaisa: got.card || 0,
    khataOnlinePaisa: got.online || 0,
    supplierPaidPaisa,
    cashInPaisa: cashSalesPaisa + khataCashPaisa,
    cashOutPaisa: refundsPaisa + supplierPaidPaisa,
    // Profit is only shown to those who may see it (publicShift)
    profitPaisa: salesPaisa - sales.reduce((sum, x) => sum + x.cost, 0) - (refundsPaisa + accountReturnsPaisa - returnCost),
  };
};

// What the drawer should hold (shifts closed before khata existed have no cashIn/Out)
export const expectedCash = (shift, t) =>
  shift.openingCashPaisa + (t.cashInPaisa ?? t.cashSalesPaisa) - (t.cashOutPaisa ?? t.refundsPaisa);

const publicShift = (shift, totals, actor) => {
  const t = totals && { ...totals };
  if (t && !can(actor, "viewProfit")) delete t.profitPaisa;
  return {
    _id: String(shift._id),
    shiftNo: shift.shiftNo,
    openedBy: shift.openedBy,
    status: shift.status,
    openedAt: shift.createdAt,
    openingCashPaisa: shift.openingCashPaisa,
    closedAt: shift.closedAt,
    countedCashPaisa: shift.countedCashPaisa,
    differencePaisa: shift.differencePaisa,
    closeNote: shift.closeNote,
    ...(t && { totals: t, expectedCashPaisa: expectedCash(shift, t) }),
  };
};

export const currentShift = async (actor) => {
  const shift = await openShiftOf(actor);
  return shift ? publicShift(shift, await shiftTotals(shift._id), actor) : null;
};

export const openShift = async ({ openingCashPaisa }, actor) => {
  const existing = await openShiftOf(actor);
  if (existing) return { shift: publicShift(existing, await shiftTotals(existing._id), actor), repeated: true };
  await shiftModel.init(); // the "one open shift per person" index exists before the first save
  try {
    const shiftNo = await nextNumber("shift");
    const shift = (await shiftModel.create({ shiftNo, actorKey: actorKey(actor), openedBy: actor, openingCashPaisa })).toObject();
    return { shift: publicShift(shift, await shiftTotals(shift._id), actor), repeated: false };
  } catch (error) {
    // Opened twice at the same moment: the other one won
    if (isDuplicateKey(error)) {
      const shift = await openShiftOf(actor);
      if (shift) return { shift: publicShift(shift, await shiftTotals(shift._id), actor), repeated: true };
    }
    throw error;
  }
};

// A sale or return saves only while its shift is still open: it touches the shift
// in its own save (transaction), so it either lands before the closing count or is
// refused with "Open your shift first"
export const touchShift = async (shiftId, session) => {
  const touched = await shiftModel.updateOne({ _id: shiftId, status: "open" }, { $set: { lastActivityAt: new Date() } }, { session });
  if (!touched.matchedCount) throw noShift();
};

// Closed first, then counted: anything saved before the close is in the totals,
// anything after is refused. Only an open shift closes (a second close finds none).
export const closeShift = async ({ countedCashPaisa, note }, actor) => {
  const shift = await requireShift(actor);
  const closing = await shiftModel
    .findOneAndUpdate({ _id: shift._id, status: "open" }, { $set: { status: "closed", closedAt: new Date(), countedCashPaisa, closeNote: note || "" } })
    .lean();
  if (!closing) throw noShift();
  const totals = await shiftTotals(shift._id);
  const expectedCashPaisa = expectedCash(shift, totals);
  const closed = await shiftModel
    .findByIdAndUpdate(shift._id, { $set: { totals, expectedCashPaisa, differencePaisa: countedCashPaisa - expectedCashPaisa } }, { new: true })
    .lean();
  return publicShift(closed, totals, actor);
};

// Managers: shifts, newest first (who, when, how much, short or over)
export const listShifts = async ({ limit = 50, cursor }, actor) => {
  const size = Math.min(200, limit);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const filter = after
    ? { $or: [{ createdAt: { $lt: new Date(Number(after[0])) } }, { createdAt: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }
    : {};
  const rows = await shiftModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(size + 1).lean();
  const page = rows.slice(0, size);
  const shifts = await Promise.all(page.map(async (s) => publicShift(s, s.status === "open" ? await shiftTotals(s._id) : s.totals, actor)));
  return { shifts, nextCursor: rows.length > size ? `${page.at(-1).createdAt.getTime()}_${page.at(-1)._id}` : null };
};

export const getShift = async (id, actor) => {
  const shift = await shiftModel.findById(id).lean();
  if (!shift) throw notFound("Shift");
  // Staff see their own shifts; managers see all
  if (!can(actor, "viewReports") && shift.actorKey !== actorKey(actor)) throw notFound("Shift");
  return publicShift(shift, shift.status === "open" ? await shiftTotals(shift._id) : shift.totals, actor);
};
