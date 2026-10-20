import jwt from "jsonwebtoken";

// The front desk: the owner (admin login) or the shared reception login, both
// sent as `atoken`. Sets req.desk = { role: "admin" | "reception" }.
// Routes the owner alone may use keep authAdmin.
const authDesk = (req, res, next) => {
  const { atoken } = req.headers;
  if (!atoken) return res.status(401).json({ success: false, message: "Unauthorized Access denied" });
  try {
    const decoded = jwt.verify(atoken, process.env.JWT_SECRET);
    if (decoded.role !== "admin" && decoded.role !== "reception") {
      return res.status(401).json({ success: false, message: "Invalid Credentials" });
    }
    req.desk = { role: decoded.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: "Session expired. Please login again." });
  }
};

export default authDesk;
