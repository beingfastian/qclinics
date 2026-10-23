import mongoose from "mongoose";

// Prescriptions the hospital's doctors send to this pharmacy (through ports.js).
// The pharmacy keeps its own copy: what was prescribed, for whom, and how much of
// each line has been sold against it.
//
//   waiting    sent by the doctor, nothing sold yet
//   partly     some lines (or part of a line) sold
//   dispensed  every line sold in full
//   closed     the pharmacy closed it (the patient didn't buy, or bought elsewhere)
//   cancelled  the doctor cancelled it before it was sold
export const RX_STATUSES = ["waiting", "partly", "dispensed", "closed", "cancelled"];

const rxItemSchema = new mongoose.Schema(
  {
    productId: { type: String }, // when the doctor picked it from the pharmacy's list
    name: { type: String, required: true },
    strength: { type: String, default: "" },
    form: { type: String, default: "" },
    dose: { type: String, default: "" }, // e.g. "1+0+1"
    days: { type: Number },
    qtyUnits: { type: Number }, // how many the doctor wants dispensed (if given)
    instructions: { type: String, default: "" },
    dispensedUnits: { type: Number, default: 0 },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    hospitalRxId: { type: String, required: true },
    rxNo: { type: Number, required: true },
    patient: { name: String, phone: String, age: String, gender: String },
    doctor: { name: String, speciality: String },
    items: { type: [rxItemSchema], default: [] },
    note: { type: String, default: "" },
    status: { type: String, enum: RX_STATUSES, default: "waiting" },
    sales: [{ _id: false, saleId: String, saleNo: Number, at: Date }],
    dispensedAt: { type: Date },
    closedNote: { type: String, default: "" },
    closedBy: { role: String, id: String, name: String },
  },
  { timestamps: true, collection: "pharmacy_prescriptions" }
);
prescriptionSchema.index({ hospitalRxId: 1 }, { unique: true });
prescriptionSchema.index({ status: 1, createdAt: 1 });
prescriptionSchema.index({ createdAt: -1, _id: -1 });

export const prescriptionModel = mongoose.models.pharmacyPrescription || mongoose.model("pharmacyPrescription", prescriptionSchema);

// Fully sold when every line has at least what was prescribed (one, if no quantity was given)
export const rxStatusAfter = (items) => {
  const done = items.every((i) => i.dispensedUnits >= Math.max(1, i.qtyUnits || 0));
  const any = items.some((i) => i.dispensedUnits > 0);
  return done ? "dispensed" : any ? "partly" : "waiting";
};
