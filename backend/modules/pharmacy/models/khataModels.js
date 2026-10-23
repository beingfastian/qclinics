import mongoose from "mongoose";

// Khata: customers who buy on credit, and what is owed to suppliers. Money in paisa.

const actorSchema = new mongoose.Schema({ role: String, id: String, name: String }, { _id: false });

// --- Customers ---
// balancePaisa is what the customer owes now (negative: money paid in advance). It
// moves only together with an entry (one save), so it always equals the entries'
// sum. creditLimitPaisa: the most they may owe (empty: no limit).
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    creditLimitPaisa: { type: Number, min: 0 },
    balancePaisa: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    nameKey: { type: String },
    phoneKey: { type: String },
  },
  { timestamps: true, collection: "pharmacy_customers" }
);
customerSchema.pre("validate", function () {
  this.nameKey = String(this.name || "").trim().toLowerCase();
  this.phoneKey = String(this.phone || "").replace(/\D/g, "");
});
customerSchema.index({ nameKey: 1 });
customerSchema.index({ phoneKey: 1 });
customerSchema.index({ balancePaisa: -1 });

export const customerModel = mongoose.models.pharmacyCustomer || mongoose.model("pharmacyCustomer", customerSchema);

// --- A customer's account: every change, never edited or deleted ---
//   sale     a bill put on the account (+)
//   payment  money received (-)
//   return   items from an account bill brought back (-)
// amountPaisa is signed; balanceAfterPaisa is the balance right after this entry.
export const CUSTOMER_ENTRY_TYPES = ["sale", "payment", "return"];
export const RECEIPT_METHODS = ["cash", "card", "online"];

const customerEntrySchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true },
    type: { type: String, enum: CUSTOMER_ENTRY_TYPES, required: true },
    amountPaisa: { type: Number, required: true },
    balanceAfterPaisa: { type: Number, required: true },
    method: { type: String, enum: RECEIPT_METHODS }, // payments
    shiftId: { type: String }, // payments taken at a counter (cash counts in its drawer)
    ref: { kind: String, id: String, no: String },
    note: { type: String, default: "" },
    by: { type: actorSchema },
    requestId: { type: String },
  },
  { timestamps: { createdAt: "at", updatedAt: false }, collection: "pharmacy_customer_entries" }
);
customerEntrySchema.index({ customerId: 1, at: -1, _id: -1 });
customerEntrySchema.index({ "ref.id": 1 }, { partialFilterExpression: { "ref.id": { $type: "string" } } });
customerEntrySchema.index({ shiftId: 1 }, { partialFilterExpression: { shiftId: { $type: "string" } } });
customerEntrySchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });

export const customerEntryModel = mongoose.models.pharmacyCustomerEntry || mongoose.model("pharmacyCustomerEntry", customerEntrySchema);

// --- Payments to suppliers ---
// What a supplier is owed = purchases (total - paid at the time) - these payments.
// Worked out from the documents when asked (no running total to drift). A cash
// payment can come out of the payer's counter drawer (fromDrawer: counted at closing).
export const SUPPLIER_PAYMENT_METHODS = ["cash", "bank", "cheque", "online"];

const supplierPaymentSchema = new mongoose.Schema(
  {
    supplierId: { type: String, required: true },
    amountPaisa: { type: Number, required: true, min: 1 },
    method: { type: String, enum: SUPPLIER_PAYMENT_METHODS, default: "cash" },
    reference: { type: String, default: "" }, // cheque or transfer number
    note: { type: String, default: "" },
    paidOn: { type: Date },
    fromDrawer: { type: Boolean, default: false },
    shiftId: { type: String },
    by: { type: actorSchema },
    requestId: { type: String },
  },
  { timestamps: true, collection: "pharmacy_supplier_payments" }
);
supplierPaymentSchema.index({ supplierId: 1, createdAt: -1 });
supplierPaymentSchema.index({ shiftId: 1 }, { partialFilterExpression: { shiftId: { $type: "string" } } });
supplierPaymentSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });

export const supplierPaymentModel = mongoose.models.pharmacySupplierPayment || mongoose.model("pharmacySupplierPayment", supplierPaymentSchema);
