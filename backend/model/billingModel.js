import mongoose from "mongoose";

// Billing: money collected at reception (consultation fees and lab charges),
// refunds, and counting the cash drawer at the end of a shift.
//
// Payments are never edited or deleted. A mistake is fixed with a refund (with
// a reason) and, if needed, a new receipt. See docs/BILLING_PLAN.md.

const METHODS = ["cash", "bank_transfer"];

// Who did it: the owner (admin login) or reception (shared login) plus the name
// the receptionist picked at the counter
const byStaffSchema = new mongoose.Schema(
  { role: { type: String, enum: ["admin", "reception"], required: true }, name: { type: String, default: "" } },
  { _id: false }
);

// --- One receipt ---
const paymentSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true, unique: true }, // e.g. "211026-0042"
  day: { type: String, required: true }, // hospital date "yyyy-mm-dd"
  seq: { type: Number, required: true }, // number within the day, for spotting gaps
  kind: { type: String, enum: ["consultation", "lab"], required: true },

  appointmentId: { type: String }, // consultation
  labOrderId: { type: String }, // lab
  labOrderNumber: { type: Number },

  patient: { id: String, name: { type: String, required: true }, phone: String },
  docId: { type: String },
  doctorName: { type: String },

  items: { type: [new mongoose.Schema({ label: String, amount: Number }, { _id: false })], default: [] },
  gross: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  net: { type: Number, required: true, min: 0 },
  // The doctor who allowed the discount (required when there is one)
  discountAllowedBy: { docId: String, name: String },
  discountReason: { type: String, default: "" },

  method: { type: String, enum: METHODS, required: true },
  reference: { type: String, default: "" }, // bank transfer id

  counterId: { type: String, required: true },
  counterName: { type: String },
  collectedBy: { type: byStaffSchema, required: true },
  collectedAt: { type: Date, default: Date.now },

  refunded: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["paid", "partly_refunded", "refunded"], default: "paid" },
  // false once fully refunded, so the visit or lab order can be paid again
  active: { type: Boolean, default: true },
  // Set when the counter is closed; that close counted this payment
  closeId: { type: String, default: null },

  // Sent by the screen with each "Collect", so a double click or a retry on a slow
  // connection returns the first receipt instead of making a second one
  requestId: { type: String },
});
paymentSchema.index({ collectedAt: -1 });
paymentSchema.index({ day: 1, seq: 1 });
paymentSchema.index({ counterId: 1, closeId: 1 });
paymentSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
// One paid receipt per visit and per lab order, even if two receptionists press Collect at once
paymentSchema.index(
  { appointmentId: 1 },
  { unique: true, partialFilterExpression: { active: true, kind: "consultation" } }
);
paymentSchema.index({ labOrderId: 1 }, { unique: true, partialFilterExpression: { active: true, kind: "lab" } });

// --- Money given back (owner only). Kept separately so the cash close can count it. ---
const refundSchema = new mongoose.Schema({
  paymentId: { type: String, required: true },
  receiptNo: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: METHODS, required: true }, // same as the payment
  reason: { type: String, required: true },
  counterId: { type: String, required: true }, // the drawer the cash came out of
  counterName: { type: String },
  by: { type: byStaffSchema, required: true },
  at: { type: Date, default: Date.now },
  closeId: { type: String, default: null },
});
refundSchema.index({ at: -1 });
refundSchema.index({ counterId: 1, closeId: 1 });

// --- Counting a counter's drawer (end of shift or day) ---
const cashCloseSchema = new mongoose.Schema({
  counterId: { type: String, required: true },
  counterName: { type: String },
  from: { type: Date }, // the previous close of this counter (none for the first)
  closedAt: { type: Date, default: Date.now },
  closedBy: { type: byStaffSchema, required: true },
  cashIn: { type: Number, default: 0 },
  cashRefunds: { type: Number, default: 0 },
  expected: { type: Number, default: 0 }, // cash that should be in the drawer
  bankTransfers: { type: Number, default: 0 }, // listed, not in the drawer
  receipts: { type: Number, default: 0 },
  countedCash: { type: Number, required: true, min: 0 },
  // How the cash was counted, e.g. { "5000": 3, "1000": 7 } (optional)
  notes: { type: Map, of: Number, default: undefined },
  difference: { type: Number, default: 0 }, // counted - expected
  note: { type: String, default: "" },
  requestId: { type: String }, // from the screen, see the index below
  verifiedAt: { type: Date },
  verifiedBy: { type: byStaffSchema },
});
cashCloseSchema.index({ counterId: 1, closedAt: -1 });
// One close per request id: a double click or a retry doesn't count the drawer twice
cashCloseSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
cashCloseSchema.index({ closedAt: -1 });

// Receipt numbers per day, given out atomically (the same way queue tokens are)
const receiptCounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

// The hospital's counters (cash drawers) and the receptionists' names for the
// "who's at the counter" list. One document.
const nameSchema = new mongoose.Schema({ name: { type: String, required: true }, active: { type: Boolean, default: true } });
const billingSettingSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "billing" },
    counters: { type: [nameSchema], default: [] },
    staff: { type: [nameSchema], default: [] },
  },
  { minimize: false }
);

export const PAYMENT_METHODS = METHODS;
export const paymentModel = mongoose.models.payment || mongoose.model("payment", paymentSchema);
export const refundModel = mongoose.models.refund || mongoose.model("refund", refundSchema);
export const cashCloseModel = mongoose.models.cashClose || mongoose.model("cashClose", cashCloseSchema);
export const receiptCounterModel = mongoose.models.receiptCounter || mongoose.model("receiptCounter", receiptCounterSchema);
export const billingSettingModel = mongoose.models.billingSetting || mongoose.model("billingSetting", billingSettingSchema);
