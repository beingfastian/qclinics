import bcrypt from "bcrypt";
import { pharmacyStaffModel } from "../models/staffModel.js";
import { PharmacyError, notFound } from "../http.js";
import { isDuplicateKey } from "../../../lib/transactions.js";

// Pharmacy staff accounts (owner only). Passwords are hashed; never returned.
const publicStaff = (s) => ({
  _id: String(s._id),
  name: s.name,
  email: s.email,
  phone: s.phone || "",
  role: s.role,
  active: s.active !== false,
  createdAt: s.createdAt,
});

export const listStaff = async () => (await pharmacyStaffModel.find().sort({ createdAt: -1 }).lean()).map(publicStaff);

export const createStaff = async ({ name, email, password, phone, role }) => {
  if (await pharmacyStaffModel.exists({ email })) {
    throw new PharmacyError("A pharmacy account with this email already exists", { status: 409, code: "email_taken" });
  }
  try {
    const staff = await pharmacyStaffModel.create({ name, email, phone, role, password: await bcrypt.hash(password, 10) });
    return publicStaff(staff);
  } catch (error) {
    // Two creates with the same email at the same moment: the unique index decides
    if (isDuplicateKey(error)) throw new PharmacyError("A pharmacy account with this email already exists", { status: 409, code: "email_taken" });
    throw error;
  }
};

export const updateStaff = async (id, { name, phone, role, active, password }) => {
  const update = {
    ...(name !== undefined && { name }),
    ...(phone !== undefined && { phone }),
    ...(role !== undefined && { role }),
    ...(active !== undefined && { active }),
    ...(password && { password: await bcrypt.hash(password, 10) }),
  };
  const staff = await pharmacyStaffModel.findByIdAndUpdate(id, update, { new: true });
  if (!staff) throw notFound("Pharmacy account");
  return publicStaff(staff);
};

// For the shared sign-in (controllers/authController.js). Returns the staff
// member, or null for an unknown email or wrong password (same answer for both).
export const checkLogin = async (email, password) => {
  const staff = await pharmacyStaffModel.findOne({ email: String(email || "").trim().toLowerCase() });
  if (!staff || !(await bcrypt.compare(String(password || ""), staff.password))) return null;
  return staff;
};
