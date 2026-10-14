import doctorModel from "../model/doctorModel.js";
import otpModel from "../model/otpModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendOTPEmail } from "../config/nodemailer.js";
import { labStaffModel } from "../model/labModel.js";
import { labEnabled } from "./labController.js";

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
    if (adminEmail && email.toLowerCase() === adminEmail && password === process.env.ADMIN_PASSWORD) {
      return res.json({ success: true, role: "admin", token: signToken({ role: "admin" }) });
    }

    const doctor =
      (await doctorModel.findOne({ email })) ||
      (await doctorModel.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } }));
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

    res.json({ success: false, message: INVALID_LOGIN });
  } catch (error) {
    console.error("Error in login:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

// Request password reset
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // Same response whether or not the doctor exists, so emails can't be enumerated
    const doctor = await doctorModel.findOne({ email });
    if (!doctor) {
      return res.json({ success: true, message: GENERIC_OTP_MESSAGE });
    }

    const otp = generateOTP();

    // Only the newest OTP is valid
    await otpModel.deleteMany({ email });
    await otpModel.create({
      email,
      otpHash: await bcrypt.hash(otp, 10),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const emailResult = await sendOTPEmail(email, otp);
    if (!emailResult.success) {
      console.error("OTP email failed:", emailResult.error);
    }

    res.json({ success: true, message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

// Verify OTP and return a short-lived reset token
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const otpRecord = await otpModel.findOne({ email });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await otpModel.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ success: false, message: "Too many attempts. Please request a new OTP." });
    }

    const isMatch = await bcrypt.compare(String(otp), otpRecord.otpHash);
    if (!isMatch) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    await otpModel.deleteOne({ _id: otpRecord._id });

    const resetToken = jwt.sign(
      { email, purpose: "password-reset" },
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
    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ success: false, message: "Invalid reset token" });
    }

    if (!newPassword || newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password should be at least 8 characters long"
      });
    }

    const doctor = await doctorModel.findOne({ email: payload.email });
    if (!doctor) {
      return res.status(400).json({ success: false, message: "Invalid reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await doctorModel.findByIdAndUpdate(doctor._id, { password: hashedPassword });

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};
