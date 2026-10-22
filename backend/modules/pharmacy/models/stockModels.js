import mongoose from "mongoose";

// --- Batches: what is on the shelf ---
// One batch per purchase line: its batch number, expiry and what each unit cost
// (after bonus units and discounts). Sales take from the batch that expires first.
const batchSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    batchNo: { type: String, default: "", trim: true },
    expiry: { type: Date }, // empty for items without expiry (e.g. nappies)
    costPerUnitPaisa: { type: Number, required: true, min: 0 }, // may have a fraction of a paisa
    receivedUnits: { type: Number, required: true, min: 0 },
    qtyUnits: { type: Number, required: true, min: 0 }, // on the shelf now; never below 0
    supplierId: { type: String },
    purchaseId: { type: String },
  },
  { timestamps: true, collection: "pharmacy_batches" }
);
// Picking order for a sale: earliest expiry first (then oldest)
batchSchema.index({ productId: 1, expiry: 1, createdAt: 1 });
batchSchema.index({ expiry: 1, qtyUnits: 1 });

export const batchModel = mongoose.models.pharmacyBatch || mongoose.model("pharmacyBatch", batchSchema);

// --- Stock movements: every change to stock, never edited or deleted ---
// qtyUnits is signed (+ in, - out). Corrections are new movements, never edits, so
// stock and cost can always be traced back.
export const MOVEMENT_TYPES = ["purchase", "sale", "sale_return", "adjustment", "expired", "damaged"];

const actorSchema = new mongoose.Schema({ role: String, id: String, name: String }, { _id: false });

const movementSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    batchId: { type: String }, // empty only for stock sold before it was entered (manager override)
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    qtyUnits: { type: Number, required: true },
    costPerUnitPaisa: { type: Number, default: 0 },
    ref: { kind: String, id: String, no: String }, // the purchase / sale / return it belongs to
    reason: { type: String, default: "" },
    negativeOverride: { type: Boolean }, // sold beyond the stock entered, allowed by a manager
    by: { type: actorSchema },
  },
  { timestamps: { createdAt: "at", updatedAt: false }, collection: "pharmacy_stock_movements" }
);
movementSchema.index({ productId: 1, at: -1, _id: -1 });
movementSchema.index({ "ref.kind": 1, "ref.id": 1 });
movementSchema.index({ negativeOverride: 1, at: -1 }, { partialFilterExpression: { negativeOverride: true } });

export const movementModel = mongoose.models.pharmacyMovement || mongoose.model("pharmacyMovement", movementSchema);

// --- Numbering (purchase numbers, later receipt numbers) ---
const sequenceSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { collection: "pharmacy_sequences", versionKey: false });
export const sequenceModel = mongoose.models.pharmacySequence || mongoose.model("pharmacySequence", sequenceSchema);

export const nextNumber = async (key, session) =>
  (await sequenceModel.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true, session })).seq;
