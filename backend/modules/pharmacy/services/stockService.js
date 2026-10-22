// The stock engine: the only code that changes stock. Purchases, sales, returns and
// corrections all go through it, so the rules hold everywhere:
//   - every change is a movement (never edited or deleted)
//   - a sale takes from the batch that expires first; expired batches are never sold
//   - a batch never goes below 0, even with two counters selling the last strip at
//     the same moment (each take is one conditional update)
//   - selling more than is entered is refused, unless a manager overrides it; the
//     override is recorded on the movement
//   - the product's running total moves in the same save
// Callers pass the transaction session (lib/transactions.js) so a sale or purchase
// saves completely or not at all. Without transactions (a standalone development
// database) a refused take puts back what it had already taken.
import mongoose from "mongoose";
import { batchModel, movementModel } from "../models/stockModels.js";
import { productModel } from "../models/productModel.js";
import { PharmacyError, notFound } from "../http.js";

const unitLabel = (product, n) => `${n} ${product.unitName || "unit"}${n === 1 ? "" : "s"}`;

// Batches a sale may use now: stock left, not expired
const sellableFilter = (productId, now = new Date()) => ({
  productId: String(productId),
  qtyUnits: { $gt: 0 },
  $or: [{ expiry: null }, { expiry: { $gt: now } }],
});

export const sellableUnits = async (productId, session) => {
  const [row] = await batchModel.aggregate([{ $match: sellableFilter(productId) }, { $group: { _id: null, units: { $sum: "$qtyUnits" } } }]).session(session || null);
  return row?.units || 0;
};

// --- In: a purchase line becomes a batch ---
export const receiveStock = async ({ batchId, product, batchNo, expiry, units, costPerUnitPaisa, supplierId, purchaseId, ref, by }, session) => {
  const [batch] = await batchModel.create(
    [
      {
        ...(batchId && { _id: batchId }),
        productId: String(product._id),
        batchNo,
        ...(expiry && { expiry }),
        costPerUnitPaisa,
        receivedUnits: units,
        qtyUnits: units,
        supplierId,
        purchaseId,
      },
    ],
    { session }
  );
  await movementModel.create(
    [{ productId: String(product._id), batchId: String(batch._id), type: "purchase", qtyUnits: units, costPerUnitPaisa, ref, by }],
    { session }
  );
  await productModel.updateOne(
    { _id: product._id },
    { $inc: { stockUnits: units }, $set: { lastCostPerUnitPaisa: costPerUnitPaisa } },
    { session }
  );
  return batch;
};

// --- Out: take units for a sale, earliest expiry first ---
// Returns the allocations [{ batchId, qtyUnits, costPerUnitPaisa, negativeOverride? }]
// (the sale keeps them: they decide its cost and profit).
export const takeStock = async ({ productId, units, type = "sale", ref, by, allowNegative = false }, session) => {
  const product = await productModel.findById(productId).session(session || null).lean();
  if (!product) throw notFound("Item");
  let remaining = units;
  const allocations = [];

  // Batches can change under us (another counter): re-read and retry a few times
  for (let pass = 0; remaining > 0 && pass < 5; pass++) {
    const batches = await batchModel.find(sellableFilter(productId)).sort({ expiry: 1, createdAt: 1 }).session(session || null).lean();
    if (!batches.length) break;
    for (const batch of batches) {
      if (!remaining) break;
      const take = Math.min(batch.qtyUnits, remaining);
      const taken = await batchModel.updateOne({ _id: batch._id, qtyUnits: { $gte: take } }, { $inc: { qtyUnits: -take } }, { session });
      if (taken.modifiedCount) {
        allocations.push({ batchId: String(batch._id), qtyUnits: take, costPerUnitPaisa: batch.costPerUnitPaisa });
        remaining -= take;
      }
    }
  }

  if (remaining > 0) {
    if (!allowNegative) {
      // Nothing changes: the transaction is undone, or (no transactions) put it back
      if (!session) {
        for (const a of allocations) await batchModel.updateOne({ _id: a.batchId }, { $inc: { qtyUnits: a.qtyUnits } });
      }
      const available = units - remaining;
      throw new PharmacyError(
        available
          ? `Only ${unitLabel(product, available)} of ${product.name} in stock`
          : `${product.name} is out of stock`,
        { status: 409, code: "insufficient_stock", extra: { productId: String(product._id), availableUnits: available } }
      );
    }
    // Sold before the purchase was entered: allowed by a manager, recorded as such
    allocations.push({ batchId: null, qtyUnits: remaining, costPerUnitPaisa: product.lastCostPerUnitPaisa || 0, negativeOverride: true });
  }

  await movementModel.create(
    allocations.map((a) => ({
      productId: String(product._id),
      ...(a.batchId && { batchId: a.batchId }),
      type,
      qtyUnits: -a.qtyUnits,
      costPerUnitPaisa: a.costPerUnitPaisa,
      ref,
      by,
      ...(a.negativeOverride && { negativeOverride: true }),
    })),
    { session, ordered: true }
  );
  await productModel.updateOne({ _id: product._id }, { $inc: { stockUnits: -units } }, { session });
  return allocations;
};

// --- Corrections on one batch (manager): count correction (+/-), expired, damaged ---
export const adjustBatch = async ({ batchId, deltaUnits, type, reason, by }, session) => {
  if (!mongoose.isValidObjectId(batchId)) throw notFound("Batch");
  const batch = await batchModel.findById(batchId).session(session || null).lean();
  if (!batch) throw notFound("Batch");
  if (type !== "adjustment" && deltaUnits > 0) {
    throw new PharmacyError("Expired or damaged stock can only be taken off", { code: "invalid" });
  }
  // A batch never goes below 0
  const changed = await batchModel.updateOne(
    { _id: batch._id, ...(deltaUnits < 0 && { qtyUnits: { $gte: -deltaUnits } }) },
    { $inc: { qtyUnits: deltaUnits } },
    { session }
  );
  if (!changed.modifiedCount) {
    throw new PharmacyError(`This batch has only ${batch.qtyUnits} left`, { status: 409, code: "insufficient_stock", extra: { availableUnits: batch.qtyUnits } });
  }
  const [movement] = await movementModel.create(
    [
      {
        productId: batch.productId,
        batchId: String(batch._id),
        type,
        qtyUnits: deltaUnits,
        costPerUnitPaisa: batch.costPerUnitPaisa,
        reason,
        ref: { kind: "adjustment" },
        by,
      },
    ],
    { session }
  );
  await productModel.updateOne({ _id: batch.productId }, { $inc: { stockUnits: deltaUnits } }, { session });
  return movement;
};
