// What staff see about stock: items expiring soon, low stock, an item's history, and
// manager corrections (through the stock engine, in one save).
import mongoose from "mongoose";
import { batchModel, movementModel } from "../models/stockModels.js";
import { productModel } from "../models/productModel.js";
import { adjustBatch } from "./stockService.js";
import { canSeeCost } from "./catalogService.js";
import { inTransaction } from "../../../lib/transactions.js";

const DAY = 86400000;

// Batches still on the shelf that expire within `days` (already expired included)
export const expiring = async ({ days = 90 }, actor) => {
  const until = new Date(Date.now() + days * DAY);
  const batches = await batchModel.find({ qtyUnits: { $gt: 0 }, expiry: { $ne: null, $lte: until } }).sort({ expiry: 1 }).limit(500).lean();
  const products = new Map(
    (await productModel.find({ _id: { $in: [...new Set(batches.map((b) => b.productId))] } }).select("name unitName strength").lean()).map((p) => [String(p._id), p])
  );
  const now = new Date();
  return batches.map((b) => ({
    batchId: String(b._id),
    productId: b.productId,
    name: products.get(b.productId)?.name || "",
    strength: products.get(b.productId)?.strength || "",
    unitName: products.get(b.productId)?.unitName || "unit",
    batchNo: b.batchNo,
    expiry: b.expiry,
    expired: b.expiry <= now,
    daysLeft: Math.ceil((b.expiry - now) / DAY),
    qtyUnits: b.qtyUnits,
    ...(canSeeCost(actor) && { valuePaisa: Math.round(b.qtyUnits * b.costPerUnitPaisa) }),
  }));
};

// Active items at or below their reorder level (sold-out first)
export const lowStock = async () =>
  (
    await productModel
      .find({ active: true, $expr: { $lte: ["$stockUnits", "$reorderLevelUnits"] } })
      .sort({ stockUnits: 1, nameKey: 1 })
      .limit(500)
      .select("name strength unitName stockUnits reorderLevelUnits")
      .lean()
  ).map((p) => ({ productId: String(p._id), name: p.name, strength: p.strength, unitName: p.unitName, stockUnits: p.stockUnits, reorderLevelUnits: p.reorderLevelUnits }));

// An item's stock history, newest first, one page at a time
export const movements = async ({ productId, limit = 50, cursor }) => {
  const size = Math.min(200, limit);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const filter = { productId };
  const page = after
    ? { $and: [filter, { $or: [{ at: { $lt: new Date(Number(after[0])) } }, { at: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await movementModel.find(page).sort({ at: -1, _id: -1 }).limit(size + 1).lean();
  const items = rows.slice(0, size);
  return { movements: items, nextCursor: rows.length > size ? `${items.at(-1).at.getTime()}_${items.at(-1)._id}` : null };
};

// Manager correction on one batch: count correction (+/-), expired or damaged (-)
export const adjust = (input, by) => inTransaction((session) => adjustBatch({ ...input, by }, session));
