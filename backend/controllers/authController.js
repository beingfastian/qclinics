import doctorModel from "../model/doctorModel.js";
import otpModel from "../model/otpModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendOTPEmail } from "../config/nodemailer.js";
import { labStaffModel } from "../model/labModel.js";
import { labEnabled } from "./labController.js";
import { sameSecret } from "../utils/secrets.js";
import { isHospital, pharmacyEnabled } from "../config/modules.js";
import { checkPharmacyLogin } from "../modules/pharmacy/index.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const GENERIC_OTP_MESSAGE = "If an account exists for this email, an OTP has been sent.";

// Generate a cryptographically random 6-digit OTP
const generateOTP = () => crypto.randomInt(100000, 1000000).toString();

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const signToken = (claims) =>
  jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "8h" });
const INVALID_LOGIN = "Invalid email or password";

// One sign-in for everyone: the email decides whether it's the admin, a doctor or
// lab staff, and the reply says which, so the staff app opens the right dashboard.
// Checked in that order; the email is matched regardless of capital letters.
// The older per-role endpoints (/api/admin/login, /api/doctor/login, /api/lab/login)
// still work.
export const login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Enter your email and password" });
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail && email.toLowerCase() === adminEmail && sameSecret(password, process.env.ADMIN_PASSWORD)) {
      return res.json({ success: true, role: "admin", token: signToken({ role: "admin" }) });
    }

    // Shared reception login (optional): the front desk works like the admin login,
    // without the owner's pages (profit, doctor shares, refunds, settings)
    const receptionEmail = String(process.env.RECEPTION_EMAIL || "").trim().toLowerCase();
    if (
      isHospital() &&
      receptionEmail &&
      process.env.RECEPTION_PASSWORD &&
      email.toLowerCase() === receptionEmail &&
      sameSecret(password, process.env.RECEPTION_PASSWORD)
    ) {
      return res.json({ success: true, role: "reception", token: signToken({ role: "reception" }) });
    }

    const doctor =
      isHospital() &&
      ((await doctorModel.findOne({ email })) ||
        (await doctorModel.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } })));
    if (doctor && (await bcrypt.compare(password, doctor.password))) {
      return res.json({ success: true, role: "doctor", token: signToken({ id: doctor._id, role: "doctor" }) });
    }

    if (labEnabled()) {
      const staff = await labStaffModel.findOne({ email: email.toLowerCase() });
      if (staff && (await bcrypt.compare(password, staff.password))) {
        if (!staff.active) {
          return res.json({ success: false, message: "This lab account is turned off. Please contact the admin." });
        }
        return res.json({ success: true, role: "lab", token: signToken({ id: staff._id, role: "lab" }) });
      }
    }

    if (pharmacyEnabled()) {
      const staff = await checkPharmacyLogin(email, password);
      if (staff) {
        if (!staff.active) {
          return res.json({ success: false, message: "This pharmacy account is turned off. Please contact the owner." });
        }
        return res.json({ success: true, role: "pharmacy", token: signToken({ id: staff._id, role: "pharmacy" }) });
      }
    }

    res.json({ success: false, message: INVALID_LOGIN });
  } catch (error) {
    console.error("Error in login:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

// --- Password reset (doctors): email a 6-digit OTP, verify it, set a new password ---
//
// Limits, per account (kept in the otp record, so they also hold on Vercel where
// there is no long-running server memory):
//   - a new OTP at most once a minute, and at most OTP_MAX_SENDS per hour
//   - OTP_MAX_ATTEMPTS wrong guesses per OTP
// The reset token from verifyOTP works once: it carries a fingerprint of the current
// password, so after the password changes the same token is refused.
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 60 * 60 * 1000;
const OTP_MAX_SENDS = 5;

const findDoctorByEmail = (email) =>
  doctorModel.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
const otpKey = (email) => String(email || "").trim().toLowerCase();
const passwordFingerprint = (doctor) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(doctor.password)).digest("base64url").slice(0, 22);

// Request password reset
export const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // Same response whether or not the doctor exists (or a limit was hit), so
    // emails can't be enumerated
    const doctor = await findDoctorByEmail(email);
    if (!doctor) {
      return res.json({ success: true, message: GENERIC_OTP_MESSAGE });
    }

    const key = otpKey(doctor.email);
    const now = Date.now();
    const previous = await otpModel.findOne({ email: key }).sort({ createdAt: -1 });
    const inWindow = previous?.windowStart && now - previous.windowStart.getTime() < OTP_WINDOW_MS;
    const sends = inWindow ? previous.sends || 1 : 0;
    if (previous && now - previous.createdAt.getTime() < OTP_COOLDOWN_MS) {
      return res.json({ success: true, message: GENERIC_OTP_MESSAGE });
    }
    if (sends >= OTP_MAX_SENDS) {
      console.warn(`Password reset: hourly OTP limit reached for ${key}`);
      return res.json({ success: true, message: GENERIC_OTP_MESSAGE });
    }

    // Only the newest OTP is valid
    const otp = generateOTP();
    const windowStart = inWindow ? previous.windowStart : new Date(now);
    const otpExpiresAt = new Date(now + OTP_TTL_MS);
    await otpModel.deleteMany({ email: key });
    await otpModel.create({
      email: key,
      otpHash: await bcrypt.hash(otp, 10),
      createdAt: new Date(now),
      otpExpiresAt,
      sends: sends + 1,
      windowStart,
      // The record stays until the hourly window ends, so the limit survives a used OTP
      expiresAt: new Date(Math.max(otpExpiresAt.getTime(), windowStart.getTime() + OTP_WINDOW_MS)),
    });

    const emailResult = await sendOTPEmail(doctor.email, otp);
    if (!emailResult.success) {
      console.error("OTP email failed:", emailResult.error);
    }

    res.json({ success: true, message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

// Verify OTP and return a short-lived, one-time reset token
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const key = otpKey(email);
    const invalid = () => res.status(400).json({ success: false, message: "Invalid or expired OTP" });

    // Each guess takes one attempt in a single atomic step, before the OTP is checked,
    // so guesses sent at the same moment can't get past the limit
    const otpRecord = await otpModel.findOneAndUpdate(
      { email: key, usedAt: null, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { sort: { createdAt: -1 }, new: true }
    );
    if (!otpRecord) {
      const latest = await otpModel.findOne({ email: key }).sort({ createdAt: -1 }).lean();
      if (latest && !latest.usedAt && latest.attempts >= MAX_OTP_ATTEMPTS) {
        return res.status(400).json({ success: false, message: "Too many attempts. Please request a new OTP." });
      }
      return invalid();
    }
    const validUntil = otpRecord.otpExpiresAt || otpRecord.expiresAt;
    if (!validUntil || validUntil < new Date()) return invalid();

    if (!(await bcrypt.compare(String(otp), otpRecord.otpHash))) return invalid();

    const doctor = await findDoctorByEmail(otpRecord.email);
    if (!doctor) return invalid();

    // Used: can't be verified again (the record stays for the hourly limit). Only one
    // of two requests with the right OTP at the same moment gets a reset token.
    const claimed = await otpModel.updateOne({ _id: otpRecord._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed.modifiedCount) return invalid();

    const resetToken = jwt.sign(
      { id: String(doctor._id), purpose: "password-reset", pw: passwordFingerprint(doctor) },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    res.json({ success: true, message: "OTP verified successfully", resetToken });
  } catch (error) {
    console.error("Error in verifyOTP:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

// Reset password (requires the reset token from verifyOTP)
export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken) {
      return res.status(400).json({ success: false, message: "Please verify OTP first" });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ success: false, message: "Reset link expired. Please start over." });
    }
    if (payload.purpose !== "password-reset" || !payload.id || !payload.pw) {
      return res.status(400).json({ success: false, message: "Invalid reset token" });
    }

    if (!newPassword || newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password should be at least 8 characters long"
      });
    }

    const doctor = await doctorModel.findById(payload.id);
    if (!doctor) {
      return res.status(400).json({ success: false, message: "Invalid reset token" });
    }
    // The password already changed since this token was given: it was used
    if (passwordFingerprint(doctor) !== payload.pw) {
      return res.status(400).json({ success: false, message: "This reset link was already used. Please start over." });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);
    // Only if the password is still the one the token was made for (two tabs at once)
    const updated = await doctorModel.updateOne({ _id: doctor._id, password: doctor.password }, { password: hashedPassword });
    if (!updated.modifiedCount) {
      return res.status(400).json({ success: false, message: "This reset link was already used. Please start over." });
    }

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};
