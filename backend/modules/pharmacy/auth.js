import jwt from "jsonwebtoken";
import { pharmacyStaffModel } from "./models/staffModel.js";
import { can } from "./permissions.js";
import { deny } from "./http.js";

// Who is calling the pharmacy API. Accepts the pharmacy staff login (header
// "ptoken") or the owner's login ("atoken", role admin). The staff member's role
// and on/off are read from the database on every request, so a role change or a
// turned-off account takes effect at once, not when the login expires.
// Sets req.actor = { role: "owner" | "manager" | "cashier", id?, name }.
const identify = async (req) => {
  const { ptoken, atoken } = req.headers;
  const token = ptoken || atoken;
  if (!token) return { status: 401, message: "Please log in" };
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { status: 401, message: "Session expired. Please login again." };
  }
  if (decoded.role === "admin") return { actor: { role: "owner", name: "Owner" } };
  if (decoded.role === "pharmacy" && decoded.id) {
    const staff = await pharmacyStaffModel.findById(decoded.id).select("name role active").lean();
    if (!staff || !staff.active) return { status: 401, message: "Please login again." };
    return { actor: { role: staff.role, id: String(staff._id), name: staff.name } };
  }
  // A valid login of another kind (doctor, lab, reception)
  return { status: 403, message: "You don't have access to the pharmacy" };
};

// Any pharmacy user, optionally limited to one permission (see permissions.js)
export const authPharmacy = (permission) => async (req, res, next) => {
  try {
    const result = await identify(req);
    if (!result.actor) return deny(res, result.status, result.message);
    if (permission && !can(result.actor, permission)) {
      return deny(res, 403, "Your role can't do this. Ask the pharmacy manager.", "forbidden");
    }
    req.actor = result.actor;
    next();
  } catch (error) {
    console.error("Pharmacy auth error:", error);
    deny(res, 500, "Something went wrong. Please try again.");
  }
};

// The owner only (staff accounts, settings)
export const ownerOnly = async (req, res, next) => {
  try {
    const result = await identify(req);
    if (!result.actor) return deny(res, result.status, result.message);
    if (result.actor.role !== "owner") return deny(res, 403, "Only the owner can do this", "forbidden");
    req.actor = result.actor;
    next();
  } catch (error) {
    console.error("Pharmacy auth error:", error);
    deny(res, 500, "Something went wrong. Please try again.");
  }
};
