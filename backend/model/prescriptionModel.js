import mongoose from "mongoose";

// A doctor's prescription for a visit. Kept by the hospital (printed for the
// patient, seen again at the next visit); when the hospital has its own pharmacy,
// a copy goes there to be dispensed (modules/pharmacy/ports.js). Patient and doctor
// details are kept as they were on the day.
const actorSchema = new mongoose.Schema({ role: String, id: String, name: String }, { _id: false });

const prescriptionSchema = new mongoose.Schema(
  {
    rxNo: { type: Number, required: true },
    docId: { type: String, required: true },
    doctor: { name: String, speciality: String },
    userId: { type: String },
    patient: { name: String, phone: String, gender: String, dob: String, age: String },
    appointmentId: { type: String },
    queueTokenId: { type: String },
    items: [
      {
        _id: false,
        productId: { type: String }, // picked from the hospital pharmacy's list
        name: { type: String, required: true },
        strength: { type: String, default: "" },
        form: { type: String, default: "" },
        dose: { type: String, default: "" }, // "1+0+1": morning + afternoon + night
        days: { type: Number },
        qtyUnits: { type: Number },
        instructions: { type: String, default: "" },
      },
    ],
    note: { type: String, default: "" },
    status: { type: String, enum: ["issued", "cancelled"], default: "issued" },
    sentToPharmacy: { type: Boolean, default: false },
    history: [{ _id: false, at: { type: Date, default: Date.now }, by: actorSchema, action: String }],
  },
  { timestamps: true, collection: "prescriptions" }
);
prescriptionSchema.index({ rxNo: 1 }, { unique: true });
prescriptionSchema.index({ docId: 1, createdAt: -1 });
prescriptionSchema.index({ userId: 1, createdAt: -1 });
prescriptionSchema.index({ appointmentId: 1 });
prescriptionSchema.index({ createdAt: -1, _id: -1 });

export const prescriptionModel = mongoose.models.prescription || mongoose.model("prescription", prescriptionSchema);

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { collection: "prescription_counters", versionKey: false });
const counterModel = mongoose.models.prescriptionCounter || mongoose.model("prescriptionCounter", counterSchema);

export const nextRxNumber = async () => (await counterModel.findOneAndUpdate({ _id: "rx" }, { $inc: { seq: 1 } }, { new: true, upsert: true })).seq;
