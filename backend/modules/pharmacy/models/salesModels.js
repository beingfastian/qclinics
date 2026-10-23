import mongoose from "mongoose";

// The counter: shifts (a person's cash drawer from opening to closing count),
// sales, held bills and returns. Money in paisa; quantities in units (tablets).

const actorSchema = new mongoose.Schema({ role: String, id: String, name: String }, { _id: false });

// Who a shift belongs to: a staff member's id, or "owner" for the admin login
export const actorKey = (actor) => (actor?.id ? `staff:${actor.id}` : `owner`);

// --- Shifts ---
// One open shift per person at a time. Expected cash at closing = opening cash +
// cash sales - cash refunds; the counted cash and the difference are kept.
const shiftSchema = new mongoose.Schema(
  {
    shiftNo: { type: Number, required: true },
    actorKey: { type: String, required: true },
    openedBy: { type: actorSchema, required: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    openingCashPaisa: { type: Number, required: true, min: 0 },
    closedAt: { type: Date },
    countedCashPaisa: { type: Number },
    expectedCashPaisa: { type: Number },
    differencePaisa: { type: Number },
    totals: { type: Object }, // the shift's sums at closing (shiftService.shiftTotals)
    closeNote: { type: String, default: "" },
    lastActivityAt: { type: Date },
  },
  { timestamps: true, collection: "pharmacy_shifts" }
);
shiftSchema.index({ shiftNo: 1 }, { unique: true });
// The second "open" for the same person (two tabs, a double click) fails here
shiftSchema.index({ actorKey: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
shiftSchema.index({ createdAt: -1, _id: -1 });
shiftSchema.index({ status: 1, closedAt: -1 });

export const shiftModel = mongoose.models.pharmacyShift || mongoose.model("pharmacyShift", shiftSchema);

// --- Sales ---
// Each line keeps the price charged and the batches it came from (with their cost),
// so profit and returns never depend on today's prices.
const allocationSchema = new mongoose.Schema(
  { batchId: String, qtyUnits: Number, costPerUnitPaisa: Number, negativeOverride: Boolean },
  { _id: false }
);

const saleItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  strength: { type: String, default: "" },
  unitName: { type: String, default: "unit" },
  packName: { type: String, default: "" },
  unitsPerPack: { type: Number, default: 1 },
  qtyUnits: { type: Number, required: true, min: 1 },
  unitPricePaisa: { type: Number, required: true },
  packPricePaisa: { type: Number },
  lineTotalPaisa: { type: Number, required: true }, // before the bill discount
  costPaisa: { type: Number, default: 0 },
  allocations: { type: [allocationSchema], default: [] },
  returnedUnits: { type: Number, default: 0 },
});

// account: on the customer's khata (any cash paid now is cashReceivedPaisa)
export const PAYMENT_METHODS = ["cash", "card", "online", "account"];

const saleSchema = new mongoose.Schema(
  {
    saleNo: { type: Number, required: true },
    shiftId: { type: String, required: true },
    by: { type: actorSchema, required: true },
    items: { type: [saleItemSchema], default: [] },
    subtotalPaisa: { type: Number, required: true },
    discountPaisa: { type: Number, default: 0 },
    totalPaisa: { type: Number, required: true },
    costPaisa: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cash" },
    cashReceivedPaisa: { type: Number, default: 0 },
    changePaisa: { type: Number, default: 0 },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    customerId: { type: String }, // an account customer
    onAccountPaisa: { type: Number, default: 0 }, // put on their khata
    prescriptionId: { type: String }, // dispensed against a doctor's prescription
    rxNo: { type: Number },
    // Sold beyond the stock entered: the manager who allowed it
    negativeOverride: { type: Boolean },
    approvedBy: { type: actorSchema },
    refundedPaisa: { type: Number, default: 0 },
    requestId: { type: String },
  },
  { timestamps: true, collection: "pharmacy_sales" }
);
saleSchema.index({ saleNo: 1 }, { unique: true });
saleSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
saleSchema.index({ shiftId: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1, _id: -1 });
saleSchema.index({ customerId: 1, createdAt: -1 }, { partialFilterExpression: { customerId: { $type: "string" } } });

export const saleModel = mongoose.models.pharmacySale || mongoose.model("pharmacySale", saleSchema);

// --- Held bills ---
// A customer steps away: the cart is parked (seen at every counter) and picked up
// later. Stock isn't reserved; it's checked when the sale is made.
const heldBillSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    by: { type: actorSchema, required: true },
    items: [{ _id: false, productId: String, name: String, qtyUnits: Number }],
    totalPaisa: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "pharmacy_held_bills" }
);
heldBillSchema.index({ createdAt: -1 });

export const heldBillModel = mongoose.models.pharmacyHeldBill || mongoose.model("pharmacyHeldBill", heldBillSchema);

// --- Returns ---
// With a bill: lines of that sale, refunded at the price paid (bill discount
// included), stock back to the batches it came from. Without a bill (manager):
// item and price chosen at the counter.
const returnSchema = new mongoose.Schema(
  {
    returnNo: { type: Number, required: true },
    shiftId: { type: String, required: true },
    by: { type: actorSchema, required: true },
    saleId: { type: String },
    saleNo: { type: Number },
    withoutBill: { type: Boolean, default: false },
    items: [
      {
        _id: false,
        productId: String,
        name: String,
        unitName: String,
        saleItemId: String,
        qtyUnits: Number,
        refundPaisa: Number,
        costPaisa: Number,
      },
    ],
    totalRefundPaisa: { type: Number, required: true },
    // cash from the drawer, or taken off the customer's khata (a bill sold on account)
    refundTo: { type: String, enum: ["cash", "account"], default: "cash" },
    customerId: { type: String },
    costPaisa: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    requestId: { type: String },
  },
  { timestamps: true, collection: "pharmacy_returns" }
);
returnSchema.index({ returnNo: 1 }, { unique: true });
returnSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
returnSchema.index({ shiftId: 1 });
returnSchema.index({ saleId: 1 });
returnSchema.index({ createdAt: -1 });

export const returnModel = mongoose.models.pharmacyReturn || mongoose.model("pharmacyReturn", returnSchema);
