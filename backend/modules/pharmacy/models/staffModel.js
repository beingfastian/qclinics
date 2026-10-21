import mongoose from "mongoose";
import { ROLES } from "../permissions.js";

// Pharmacy staff: their own login (created by the owner), a role, and on/off.
// All pharmacy collections are prefixed "pharmacy_" so the module's data stays
// separate from the hospital's, in both a hospital and a standalone pharmacy.
const staffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, default: "" },
    role: { type: String, enum: ROLES, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "pharmacy_staff" }
);

export const pharmacyStaffModel = mongoose.models.pharmacyStaff || mongoose.model("pharmacyStaff", staffSchema);
