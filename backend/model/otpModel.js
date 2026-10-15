import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true }, // lowercase
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }, // when this OTP was sent
  otpExpiresAt: { type: Date }, // the OTP works until then
  usedAt: { type: Date },
  // Sends in the current hour, for the "at most N per hour" limit
  sends: { type: Number, default: 1 },
  windowStart: { type: Date },
  // When the record is deleted (end of the OTP's life or the hourly window, whichever is later)
  expiresAt: { type: Date, required: true },
});

// MongoDB removes the document once expiresAt has passed
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const otpModel = mongoose.models.otp || mongoose.model("otp", otpSchema);
export default otpModel;
