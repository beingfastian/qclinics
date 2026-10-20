import jwt from "jsonwebtoken";
import { labStaffModel } from "../model/labModel.js";

// Accepts an admin token (atoken), a doctor token (dtoken) or a lab token (ltoken)
// and sets req.recipient / req.recipientType for notification queries.
// Lab staff share one inbox ("lab"), like a department notice board.
const authStaff = async (req, res, next) => {
  try {
    const { atoken, dtoken, ltoken } = req.headers;
    const token = atoken || dtoken || ltoken;
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized Access denied" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === "admin" || decoded.role === "reception") {
      // Reception runs the queue like the admin login and shares its notification inbox
      req.recipient = "admin";
      req.recipientType = "admin";
      if (decoded.role === "reception") req.isReception = true;
    } else if (decoded.role === "doctor" && decoded.id) {
      req.recipient = decoded.id;
      req.recipientType = "doctor";
    } else if (decoded.role === "lab" && decoded.id) {
      // A turned-off lab account stops working at once, not when its login expires
      if (!(await labStaffModel.exists({ _id: decoded.id, active: true }))) {
        return res.status(401).json({ success: false, message: "Please login again." });
      }
      req.recipient = "lab";
      req.recipientType = "lab";
    } else {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Session expired. Please login again." });
  }
};

export default authStaff;
