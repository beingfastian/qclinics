import mongoose from "mongoose";

// A patient. Identified by CNIC when given; the phone is a contact number, not an
// identity: in Pakistan a family often shares one phone (father, mother and children
// registered on the same number), and some walk-in patients have no phone at all.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cnic: { type: String, unique: true, sparse: true }, // Unique CNIC (when known)
  phone: { type: String, index: true }, // contact number; can be shared by a family
  // "yyyy-mm-dd". Walk-ins registered at the queue give only an age: dob is then worked
  // out from it and dobEstimated is true.
  dob: { type: String },
  dobEstimated: { type: Boolean },
  gender: { type: String, default: "Male" },
  address: { type: Object, default: () => ({ line1: "", line2: "" }) },
  image: { type: String },
  whatsappEnabled: { type: Boolean, default: false },
  whatsappNumber: { type: String, default: "" },
  // When the patient agreed to receive WhatsApp messages (set when WhatsApp is enabled)
  whatsappConsentAt: { type: Date },
  // Language of WhatsApp messages: "ur" (Urdu) or "en" (English). Missing on older
  // records, which then use WHATSAPP_DEFAULT_LANGUAGE (Urdu unless set).
  language: { type: String, enum: ["ur", "en"] },
  email: { type: String, unique: true, sparse: true },
  // The last 10 digits of phone and whatsappNumber, however they were typed
  // ("0300 1234567", "+923001234567"), indexed so reception's full-number search is
  // a direct lookup instead of reading every patient. Kept up to date below.
  phoneKeys: { type: [String], index: true },
  password: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const phoneKey = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};
export const phoneKeysOf = (phone, whatsappNumber) => [...new Set([phoneKey(phone), phoneKey(whatsappNumber)].filter(Boolean))];

// new / create / save
userSchema.pre("save", function () {
  this.phoneKeys = phoneKeysOf(this.phone, this.whatsappNumber);
});
// findByIdAndUpdate / findOneAndUpdate that change a number: recompute from the saved record
userSchema.post("findOneAndUpdate", async function () {
  const update = this.getUpdate() || {};
  const touched = (fields) => fields && ("phone" in fields || "whatsappNumber" in fields);
  if (!touched(update) && !touched(update.$set) && !touched(update.$unset)) return;
  const saved = await this.model.findOne(this.getQuery()).select("phone whatsappNumber").lean();
  if (saved) await this.model.updateOne({ _id: saved._id }, { $set: { phoneKeys: phoneKeysOf(saved.phone, saved.whatsappNumber) } });
});

const userModel = mongoose.models.user || mongoose.model("user", userSchema);

export default userModel;
