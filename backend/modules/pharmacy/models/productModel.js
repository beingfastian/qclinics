import mongoose from "mongoose";

// A medicine or other item the pharmacy sells.
//
// Stock is counted in base units (tablets, capsules, bottles, pieces). An item can
// also be sold by its pack (e.g. a strip of 10 tablets): unitsPerPack. Prices are in
// paisa (integers), so Rs 12.50 is 1250 and nothing is lost to rounding.
//
// salt + strength is the generic medicine (e.g. "paracetamol" "500 mg"): items with
// the same saltKey are substitutes for each other.
export const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "drops", "cream", "ointment", "inhaler", "sachet", "other"];
export const CATEGORIES = ["medicine", "surgical", "cosmetic", "baby", "other"];

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, default: "medicine" },
    salt: { type: String, default: "", trim: true },
    strength: { type: String, default: "", trim: true },
    form: { type: String, enum: FORMS, default: "other" },
    manufacturer: { type: String, default: "", trim: true },
    variant: { type: String, default: "", trim: true }, // e.g. a size: "Medium"
    barcodes: { type: [String], default: [] },

    unitName: { type: String, default: "unit", trim: true }, // "tablet", "bottle", "piece"
    packName: { type: String, default: "", trim: true }, // "strip", "box"; empty = sold by unit only
    unitsPerPack: { type: Number, default: 1, min: 1 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    packPricePaisa: { type: Number, min: 0 }, // empty = unitsPerPack x unit price

    trackExpiry: { type: Boolean, default: true },
    reorderLevelUnits: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },

    // Kept by the stock service in the same save as every stock movement
    stockUnits: { type: Number, default: 0 }, // can go below 0 only by a logged manager override
    lastCostPerUnitPaisa: { type: Number, default: 0 }, // from the latest purchase

    // For fast search: lower-case copies (prefix search uses the indexes)
    nameKey: { type: String, index: true },
    saltKey: { type: String, index: true }, // "paracetamol 500 mg"
  },
  { timestamps: true, collection: "pharmacy_products" }
);

// A barcode belongs to one product only (items without barcodes aren't indexed)
productSchema.index({ barcodes: 1 }, { unique: true, partialFilterExpression: { "barcodes.0": { $exists: true } } });
productSchema.index({ active: 1, stockUnits: 1 });

const keyOf = (text) => String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
export const saltKeyOf = (salt, strength) => (salt ? keyOf(`${salt} ${strength || ""}`) : "");

productSchema.pre("validate", function () {
  this.nameKey = keyOf(this.name);
  this.saltKey = saltKeyOf(this.salt, this.strength);
});

export const productModel = mongoose.models.pharmacyProduct || mongoose.model("pharmacyProduct", productSchema);
