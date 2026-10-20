import jwt from "jsonwebtoken";
import doctorModel from "../model/doctorModel.js";
import { labStaffModel } from "../model/labModel.js";

// Accepts a logged-in admin (atoken), doctor (dtoken) or lab staff member (ltoken),
// limited to the given roles. Sets req.actor = { role, id, name } from the token,
// never from the request body. Doctors and lab staff must still exist (and lab
// staff must be active), so a deleted/deactivated account stops working at once.
const authRoles = (...roles) => async (req, res, next) => {
  const { atoken, dtoken, ltoken } = req.headers;
  const token = atoken || dtoken || ltoken;
  if (!token) return res.status(401).json({ success: false, message: "Please log in" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: "Session expired. Please login again." });
  }

  try {
    if (decoded.role === "admin" && roles.includes("admin")) {
      req.actor = { role: "admin", name: "Admin" };
      return next();
    }
    if (decoded.role === "reception" && roles.includes("reception")) {
      req.actor = { role: "reception", name: "Reception" };
      return next();
    }
    if (decoded.role === "doctor" && roles.includes("doctor") && decoded.id) {
      const doctor = await doctorModel.findById(decoded.id).select("name speciality").lean();
      if (!doctor) return res.status(401).json({ success: false, message: "Please login again." });
      req.actor = { role: "doctor", id: String(doctor._id), name: doctor.name };
      req.doctor = doctor;
      return next();
    }
    if (decoded.role === "lab" && roles.includes("lab") && decoded.id) {
      const staff = await labStaffModel.findById(decoded.id).select("name active").lean();
      if (!staff || !staff.active) return res.status(401).json({ success: false, message: "Please login again." });
      req.actor = { role: "lab", id: String(staff._id), name: staff.name };
      return next();
    }
    // Valid login, but this page isn't for that role
    return res.status(403).json({ success: false, message: "You don't have access to this" });
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(500).json({ success: false, message: "Authentication error" });
  }
};

export default authRoles;
