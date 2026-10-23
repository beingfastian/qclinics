// The dashboard and reports. Everything is worked out from the sales, returns and
// batches themselves (no running totals that could drift), in the shop's local days
// (time.js). Money in paisa.
//
// Sales are counted on the day they were made, returns on the day they were taken
// back. Net sales = sales - refunds. Profit = (sales - their cost) - (refunds - the
// cost of what came back). An item's revenue is its line after its share of the
// bill discount, so items add up to the bills.
//
// Cost and profit only reach those who may see them (viewProfit).
import { saleModel, returnModel, shiftModel, heldBillModel } from "../models/salesModels.js";
import { batchModel } from "../models/stockModels.js";
import { productModel } from "../models/productModel.js";
import { currentShift } from "./shiftService.js";
import { can } from "../permissions.js";
import { PharmacyError } from "../http.js";
import { offsetText, localDate, dayRange } from "../time.js";

const DAY = 86400000;
const MAX_DAYS = 366;

// The line's revenue after its share of the bill discount (whole paisa)
const lineNet = {
  $cond: [
    { $gt: ["$subtotalPaisa", 0] },
    { $floor: { $add: [{ $divide: [{ $multiply: ["$items.lineTotalPaisa", "$totalPaisa"] }, "$subtotalPaisa"] }, 0.5] } },
    0,
  ],
};

const checkRange = (from, to) => {
  if (from > to) throw new PharmacyError("The start date is after the end date", { code: "invalid" });
  if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > MAX_DAYS) throw new PharmacyError("Choose at most a year", { code: "invalid" });
  return dayRange(from, to);
};

// Remove cost and profit for those who may not see them
const hideCost = (row, actor) => {
  if (can(actor, "viewProfit")) return row;
  const { costPaisa, profitPaisa, ...rest } = row;
  return rest;
};

const totalsFor = async (start, end) => {
  const [[s], [r]] = await Promise.all([
    saleModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: null,
          bills: { $sum: 1 },
          salesPaisa: { $sum: "$totalPaisa" },
          discountPaisa: { $sum: "$discountPaisa" },
          costPaisa: { $sum: "$costPaisa" },
          cashPaisa: { $sum: { $cond: [{ $eq: ["$paymentMethod", "cash"] }, "$totalPaisa", 0] } },
          cardPaisa: { $sum: { $cond: [{ $eq: ["$paymentMethod", "card"] }, "$totalPaisa", 0] } },
          onlinePaisa: { $sum: { $cond: [{ $eq: ["$paymentMethod", "online"] }, "$totalPaisa", 0] } },
          oversoldBills: { $sum: { $cond: ["$negativeOverride", 1, 0] } },
        },
      },
    ]),
    returnModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, returns: { $sum: 1 }, refundsPaisa: { $sum: "$totalRefundPaisa" }, costPaisa: { $sum: "$costPaisa" } } },
    ]),
  ]);
  const salesPaisa = s?.salesPaisa || 0;
  const refundsPaisa = r?.refundsPaisa || 0;
  const costPaisa = (s?.costPaisa || 0) - (r?.costPaisa || 0);
  const netSalesPaisa = salesPaisa - refundsPaisa;
  return {
    bills: s?.bills || 0,
    salesPaisa,
    discountPaisa: s?.discountPaisa || 0,
    cashPaisa: s?.cashPaisa || 0,
    cardPaisa: s?.cardPaisa || 0,
    onlinePaisa: s?.onlinePaisa || 0,
    returns: r?.returns || 0,
    refundsPaisa,
    netSalesPaisa,
    costPaisa,
    profitPaisa: netSalesPaisa - costPaisa,
    oversoldBills: s?.oversoldBills || 0,
  };
};

const byDay = async (start, end) => {
  const tz = offsetText();
  const day = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } };
  const [sales, returns] = await Promise.all([
    saleModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: day, bills: { $sum: 1 }, salesPaisa: { $sum: "$totalPaisa" }, costPaisa: { $sum: "$costPaisa" } } },
    ]),
    returnModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: day, refundsPaisa: { $sum: "$totalRefundPaisa" }, costPaisa: { $sum: "$costPaisa" } } },
    ]),
  ]);
  const days = new Map();
  for (let t = start.getTime(); t < end.getTime(); t += DAY) {
    const date = localDate(new Date(t));
    days.set(date, { date, bills: 0, salesPaisa: 0, refundsPaisa: 0, costPaisa: 0 });
  }
  for (const s of sales) Object.assign(days.get(s._id) || {}, { bills: s.bills, salesPaisa: s.salesPaisa, costPaisa: s.costPaisa });
  for (const r of returns) {
    const d = days.get(r._id);
    if (d) Object.assign(d, { refundsPaisa: r.refundsPaisa, costPaisa: d.costPaisa - r.costPaisa });
  }
  return [...days.values()].map((d) => ({ ...d, netSalesPaisa: d.salesPaisa - d.refundsPaisa, profitPaisa: d.salesPaisa - d.refundsPaisa - d.costPaisa }));
};

const byStaff = (start, end) =>
  saleModel.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { role: "$by.role", id: "$by.id" },
        name: { $last: "$by.name" },
        bills: { $sum: 1 },
        salesPaisa: { $sum: "$totalPaisa" },
        discountPaisa: { $sum: "$discountPaisa" },
        oversoldBills: { $sum: { $cond: ["$negativeOverride", 1, 0] } },
      },
    },
    { $sort: { salesPaisa: -1 } },
    { $project: { _id: 0, name: 1, role: "$_id.role", bills: 1, salesPaisa: 1, discountPaisa: 1, oversoldBills: 1 } },
  ]);

// Items sold in the period, with what came back
export const itemsReport = async ({ from, to, sort = "revenue", limit = 200 }, actor) => {
  const { start, end } = checkRange(from, to);
  const [sold, back] = await Promise.all([
    saleModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          name: { $last: "$items.name" },
          strength: { $last: "$items.strength" },
          unitName: { $last: "$items.unitName" },
          unitsSold: { $sum: "$items.qtyUnits" },
          revenuePaisa: { $sum: lineNet },
          costPaisa: { $sum: "$items.costPaisa" },
          bills: { $sum: 1 },
        },
      },
    ]),
    returnModel.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", name: { $last: "$items.name" }, unitsReturned: { $sum: "$items.qtyUnits" }, refundsPaisa: { $sum: "$items.refundPaisa" }, costPaisa: { $sum: "$items.costPaisa" } } },
    ]),
  ]);
  const rows = new Map(sold.map((s) => [s._id, { productId: s._id, name: s.name, strength: s.strength, unitName: s.unitName, unitsSold: s.unitsSold, bills: s.bills, unitsReturned: 0, revenuePaisa: s.revenuePaisa, refundsPaisa: 0, costPaisa: s.costPaisa }]));
  for (const b of back) {
    const row = rows.get(b._id) || { productId: b._id, name: b.name, strength: "", unitName: "", unitsSold: 0, bills: 0, revenuePaisa: 0, costPaisa: 0 };
    rows.set(b._id, { ...row, unitsReturned: b.unitsReturned, refundsPaisa: b.refundsPaisa, costPaisa: row.costPaisa - b.costPaisa });
  }
  const items = [...rows.values()].map((r) => {
    const netPaisa = r.revenuePaisa - r.refundsPaisa;
    return { ...r, netUnits: r.unitsSold - r.unitsReturned, netPaisa, profitPaisa: netPaisa - r.costPaisa };
  });
  const key = { revenue: "netPaisa", units: "netUnits", profit: can(actor, "viewProfit") ? "profitPaisa" : "netPaisa" }[sort] || "netPaisa";
  items.sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
  return { from, to, count: items.length, items: items.slice(0, Math.min(1000, limit)).map((r) => hideCost(r, actor)) };
};

export const summaryReport = async ({ from, to }, actor) => {
  const { start, end } = checkRange(from, to);
  const [totals, days, staff] = await Promise.all([totalsFor(start, end), byDay(start, end), byStaff(start, end)]);
  return { from, to, totals: hideCost(totals, actor), days: days.map((d) => hideCost(d, actor)), staff };
};

// What is on the shelf, at cost: sellable and already expired
export const stockValue = async () => {
  const now = new Date();
  const [row] = await batchModel.aggregate([
    { $match: { qtyUnits: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        valuePaisa: { $sum: { $multiply: ["$qtyUnits", "$costPerUnitPaisa"] } },
        expiredPaisa: { $sum: { $cond: [{ $and: [{ $ne: ["$expiry", null] }, { $lte: ["$expiry", now] }] }, { $multiply: ["$qtyUnits", "$costPerUnitPaisa"] }, 0] } },
      },
    },
  ]);
  return { valuePaisa: Math.round(row?.valuePaisa || 0), expiredPaisa: Math.round(row?.expiredPaisa || 0) };
};

// The home page. Everyone: their shift, held bills, stock alerts. Managers and the
// owner: today's takings, open shifts, recent shortages, best sellers, stock value.
export const dashboard = async (actor) => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * DAY);
  const [myShift, held, lowStock, expiringSoon, expiredOnShelf] = await Promise.all([
    currentShift(actor),
    heldBillModel.countDocuments(),
    productModel.countDocuments({ active: true, $expr: { $lte: ["$stockUnits", "$reorderLevelUnits"] } }),
    batchModel.countDocuments({ qtyUnits: { $gt: 0 }, expiry: { $gt: now, $lte: in30 } }),
    batchModel.countDocuments({ qtyUnits: { $gt: 0 }, expiry: { $ne: null, $lte: now } }),
  ]);
  const out = { today: localDate(now), myShift, heldBills: held, alerts: { lowStock, expiringSoon, expiredOnShelf } };
  if (!can(actor, "viewReports")) return out;

  const { start, end } = dayRange(out.today, out.today);
  const since = new Date(now.getTime() - 7 * DAY);
  const [totals, openShifts, shortages, top, value] = await Promise.all([
    totalsFor(start, end),
    shiftModel.find({ status: "open" }).sort({ createdAt: 1 }).limit(50).lean(),
    shiftModel
      .find({ status: "closed", closedAt: { $gte: since }, differencePaisa: { $ne: 0 } })
      .sort({ closedAt: -1 })
      .limit(20)
      .select("shiftNo openedBy closedAt differencePaisa closeNote")
      .lean(),
    itemsReport({ from: out.today, to: out.today, sort: "revenue", limit: 5 }, actor),
    stockValue(),
  ]);
  const openTotals = await Promise.all(
    openShifts.map((s) =>
      saleModel.aggregate([{ $match: { shiftId: String(s._id) } }, { $group: { _id: null, bills: { $sum: 1 }, salesPaisa: { $sum: "$totalPaisa" } } }])
    )
  );
  return {
    ...out,
    totals: hideCost(totals, actor),
    openShifts: openShifts.map((s, i) => ({ _id: String(s._id), shiftNo: s.shiftNo, name: s.openedBy?.name, openedAt: s.createdAt, bills: openTotals[i][0]?.bills || 0, salesPaisa: openTotals[i][0]?.salesPaisa || 0 })),
    shortages: shortages.map((s) => ({ _id: String(s._id), shiftNo: s.shiftNo, name: s.openedBy?.name, closedAt: s.closedAt, differencePaisa: s.differencePaisa, closeNote: s.closeNote })),
    topItems: top.items,
    ...(can(actor, "viewProfit") && { stockValue: value }),
  };
};
