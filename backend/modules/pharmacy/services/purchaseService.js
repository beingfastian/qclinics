// Purchases: stock received against a supplier's invoice. One save (a transaction):
// the purchase, a batch per line and its stock movement, and the items' stock totals.
// A double click or a retry with the same requestId returns the first purchase.
import mongoose from "mongoose";
import { purchaseModel, supplierModel } from "../models/purchaseModels.js";
import { productModel } from "../models/productModel.js";
import { nextNumber } from "../models/stockModels.js";
import { receiveStock } from "./stockService.js";
import { PharmacyError, notFound } from "../http.js";
import { inTransaction, isDuplicateKey } from "../../../lib/transactions.js";

const PAGE = 50;
const MAX_PAGE = 200;

// Work out one invoice line: units received (bonus included), line total and the
// real cost of each unit (free bonus units lower it)
export const priceLine = (product, line) => {
  const unitsPerPack = product.unitsPerPack || 1;
  const bought = line.packs * unitsPerPack + line.looseUnits;
  const units = bought + line.bonusUnits;
  const gross = line.packs * line.packCostPaisa + (line.looseUnits * line.packCostPaisa) / unitsPerPack;
  const lineTotalPaisa = Math.round(gross - line.discountPaisa);
  return { units, bought, lineTotalPaisa, costPerUnitPaisa: units ? lineTotalPaisa / units : 0 };
};

export const createPurchase = async (input, by) => {
  if (input.requestId) {
    const repeat = await purchaseModel.findOne({ requestId: input.requestId }).lean();
    if (repeat) return { purchase: repeat, repeated: true };
  }
  const supplier = await supplierModel.findById(input.supplierId).lean();
  if (!supplier || !supplier.active) throw notFound("Supplier");

  const ids = [...new Set(input.items.map((l) => l.productId))];
  const products = new Map((await productModel.find({ _id: { $in: ids } }).lean()).map((p) => [String(p._id), p]));
  const now = new Date();
  const lines = input.items.map((line, index) => {
    const product = products.get(line.productId);
    const at = `Line ${index + 1}`;
    if (!product || !product.active) throw new PharmacyError(`${at}: item not found`, { status: 404, code: "not_found" });
    if (product.trackExpiry && !line.expiry) throw new PharmacyError(`${at} (${product.name}): enter the expiry date`, { code: "invalid" });
    if (line.expiry && line.expiry <= now) throw new PharmacyError(`${at} (${product.name}): this batch has already expired`, { code: "invalid" });
    const priced = priceLine(product, line);
    if (priced.bought < 1) throw new PharmacyError(`${at} (${product.name}): enter the quantity bought`, { code: "invalid" });
    if (priced.lineTotalPaisa < 0) throw new PharmacyError(`${at} (${product.name}): the discount is more than the line`, { code: "invalid" });
    return { product, line, ...priced };
  });
  const totalPaisa = lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0);
  if (input.paidPaisa > totalPaisa) throw new PharmacyError("Paid can't be more than the invoice total", { code: "invalid" });

  await purchaseModel.init(); // the unique request id index exists before the first save
  try {
    const purchase = await inTransaction(async (session) => {
      const _id = new mongoose.Types.ObjectId();
      const purchaseNo = await nextNumber("purchase", session);
      const ref = { kind: "purchase", id: String(_id), no: String(purchaseNo) };
      const items = lines.map((l) => ({
        productId: String(l.product._id),
        name: l.product.name,
        batchNo: l.line.batchNo,
        ...(l.product.trackExpiry && { expiry: l.line.expiry }),
        packs: l.line.packs,
        looseUnits: l.line.looseUnits,
        bonusUnits: l.line.bonusUnits,
        units: l.units,
        packCostPaisa: l.line.packCostPaisa,
        discountPaisa: l.line.discountPaisa,
        lineTotalPaisa: l.lineTotalPaisa,
        costPerUnitPaisa: l.costPerUnitPaisa,
        batchId: String(new mongoose.Types.ObjectId()),
      }));
      // The purchase first: its unique request id stops a double submit before any
      // stock moves (this matters most without transactions, where nothing is undone)
      const [saved] = await purchaseModel.create(
        [
          {
            _id,
            purchaseNo,
            supplierId: String(supplier._id),
            supplierName: supplier.name,
            invoiceNo: input.invoiceNo,
            ...(input.invoiceDate && { invoiceDate: input.invoiceDate }),
            items,
            totalPaisa,
            paidPaisa: input.paidPaisa,
            notes: input.notes,
            by,
            ...(input.requestId && { requestId: input.requestId }),
          },
        ],
        { session }
      );
      for (const [i, l] of lines.entries()) {
        await receiveStock(
          {
            batchId: items[i].batchId,
            product: l.product,
            batchNo: l.line.batchNo,
            expiry: l.product.trackExpiry ? l.line.expiry : undefined,
            units: l.units,
            costPerUnitPaisa: l.costPerUnitPaisa,
            supplierId: String(supplier._id),
            purchaseId: String(_id),
            ref,
            by,
          },
          session
        );
      }
      return saved.toObject();
    });
    return { purchase, repeated: false };
  } catch (error) {
    // The same request arrived twice at once: the other one saved it
    if (isDuplicateKey(error) && input.requestId) {
      const repeat = await purchaseModel.findOne({ requestId: input.requestId }).lean();
      if (repeat) return { purchase: repeat, repeated: true };
    }
    throw error;
  }
};

export const listPurchases = async ({ supplierId, limit, cursor }) => {
  const filter = supplierId ? { supplierId } : {};
  const size = Math.min(MAX_PAGE, limit || PAGE);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const page = after
    ? { $and: [filter, { $or: [{ createdAt: { $lt: new Date(Number(after[0])) } }, { createdAt: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await purchaseModel.find(page).sort({ createdAt: -1, _id: -1 }).limit(size + 1).select("-items").lean();
  const items = rows.slice(0, size);
  return { purchases: items, nextCursor: rows.length > size ? `${items.at(-1).createdAt.getTime()}_${items.at(-1)._id}` : null };
};

export const getPurchase = async (id) => {
  const purchase = await purchaseModel.findById(id).lean();
  if (!purchase) throw notFound("Purchase");
  return purchase;
};
