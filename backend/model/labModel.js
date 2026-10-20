import mongoose from "mongoose";

// --- Lab staff: their own login, created by admin. They only see lab screens. ---
const labStaffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String, default: "" },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

// --- Tests the lab offers (the list doctors pick from) ---
const labTestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Blood, Urine, Stool, Swab, Imaging, Other: shown to the patient/lab so they know what to give
  sampleType: { type: String, default: "Blood" },
  // Optional; payment is handled at the counter, this is for reference only
  price: { type: Number },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
labTestSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

// Who did something: role + id + name (names are kept so history reads well later)
const actorSchema = new mongoose.Schema(
  { role: { type: String, enum: ["admin", "doctor", "lab"], required: true }, id: String, name: String },
  { _id: false }
);

// A report file in whatever storage is configured (see services/reportStorage.js)
const reportFileSchema = new mongoose.Schema(
  {
    storage: { type: String, required: true }, // "cloudinary" | "local" | later "gdrive"
    key: { type: String, required: true }, // the file's id in that storage
    fileName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    note: { type: String }, // lab's note to the doctor
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: actorSchema },
  },
  { _id: true }
);

// --- A doctor's request for tests for one patient ---
//   ordered          waiting for the lab
//   report_uploaded  lab uploaded the report; waiting for the doctor's review
//   returned         doctor sent it back to the lab with a note (lab uploads again)
//   approved         doctor approved the report
//   cancelled        doctor cancelled the request (before a report was approved)
const labOrderSchema = new mongoose.Schema({
  orderNumber: { type: Number, required: true, unique: true },
  status: {
    type: String,
    enum: ["ordered", "report_uploaded", "returned", "approved", "cancelled"],
    default: "ordered",
  },
  urgent: { type: Boolean, default: false },

  docId: { type: String, required: true },
  doctor: { name: String, speciality: String },

  // The patient: a registered patient (userId), or a walk-in known only by name/phone
  userId: { type: String },
  patient: {
    name: { type: String, required: true },
    phone: String,
    gender: String,
    dob: String,
    age: String, // for walk-ins without a date of birth, as told at the desk
  },
  // Where the order came from (optional): the appointment or the queue token
  appointmentId: { type: String },
  queueTokenId: { type: String },

  tests: [
    new mongoose.Schema(
      { testId: String, name: { type: String, required: true }, sampleType: String },
      { _id: false }
    ),
  ],
  doctorNote: { type: String, default: "" }, // clinical note / what to look for

  // Report files, newest last (a returned report is replaced by a new upload; old ones are kept)
  reports: { type: [reportFileSchema], default: [] },
  review: {
    at: Date,
    note: String, // doctor's note when returning a report
  },
  // Set when reception collects the lab charges (services/billingService.js); unset if refunded in full
  payment: {
    type: new mongoose.Schema({ receiptNo: String, net: Number, paidAt: Date }, { _id: false }),
    default: undefined,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  history: {
    type: [
      new mongoose.Schema(
        { at: { type: Date, default: Date.now }, by: actorSchema, action: String, note: String },
        { _id: false }
      ),
    ],
    default: [],
  },
});
labOrderSchema.index({ status: 1, createdAt: -1 });
labOrderSchema.index({ docId: 1, createdAt: -1 });
labOrderSchema.index({ userId: 1, createdAt: -1 });

// Order numbers count up for the whole hospital (L-1, L-2, ...), atomically
const labCounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

export const labStaffModel = mongoose.models.labStaff || mongoose.model("labStaff", labStaffSchema);
export const labTestModel = mongoose.models.labTest || mongoose.model("labTest", labTestSchema);
export const labOrderModel = mongoose.models.labOrder || mongoose.model("labOrder", labOrderSchema);
export const labCounterModel = mongoose.models.labCounter || mongoose.model("labCounter", labCounterSchema);
