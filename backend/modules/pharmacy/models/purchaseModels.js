import mongoose from "mongoose";

// --- Suppliers (distributors) ---
const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
    nameKey: { type: String, index: true },
  },
  { timestamps: true, collection: "pharmacy_suppliers" }
);
supplierSchema.pre("validate", function () {
  this.nameKey = String(this.name || "").trim().toLowerCase();
});
export const supplierModel = mongoose.models.pharmacySupplier || mongoose.model("pharmacySupplier", supplierSchema);

// --- Purchases: stock received from a supplier's invoice ---
// Saved once and never edited (stock corrections are separate movements). What is
// still owed to the supplier (total - paid) is the supplier's khata, added later.
const lineSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true }, // as it was when bought
    batchNo: { type: String, default: "" },
    expiry: { type: Date },
    packs: { type: Number, default: 0, min: 0 },
    looseUnits: { type: Number, default: 0, min: 0 },
    bonusUnits: { type: Number, default: 0, min: 0 }, // free from the supplier ("bonus")
    units: { type: Number, required: true, min: 1 }, // total received, bonus included
    packCostPaisa: { type: Number, default: 0, min: 0 }, // price on the invoice, per pack
    discountPaisa: { type: Number, default: 0, min: 0 }, // trade discount on this line
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    costPerUnitPaisa: { type: Number, required: true, min: 0 }, // line total / units (bonus lowers it)
    batchId: { type: String },
  },
  { _id: false }
);

const actorSchema = new mongoose.Schema({ role: String, id: String, name: String }, { _id: false });

const purchaseSchema = new mongoose.Schema(
  {
    purchaseNo: { type: Number, required: true, unique: true },
    supplierId: { type: String, required: true },
    supplierName: { type: String, required: true },
    invoiceNo: { type: String, default: "", trim: true },
    invoiceDate: { type: Date },
    items: { type: [lineSchema], default: [] },
    totalPaisa: { type: Number, required: true, min: 0 },
    paidPaisa: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: "" },
    by: { type: actorSchema },
    requestId: { type: String }, // one purchase per request (double click, retry)
  },
  { timestamps: true, collection: "pharmacy_purchases" }
);
purchaseSchema.index({ createdAt: -1, _id: -1 });
purchaseSchema.index({ supplierId: 1, createdAt: -1 });
purchaseSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });

export const purchaseModel = mongoose.models.pharmacyPurchase || mongoose.model("pharmacyPurchase", purchaseSchema);
