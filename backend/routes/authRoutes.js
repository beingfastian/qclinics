import express from "express";
import { login, forgotPassword, verifyOTP, resetPassword } from "../controllers/authController.js";

const router = express.Router();

// One sign-in for admin, doctors and lab staff
router.post("/login", login);

// Forgot password
router.post("/forgot-password", forgotPassword);

// Verify OTP
router.post("/verify-otp", verifyOTP);

// Reset password
router.post("/reset-password", resetPassword);

export default router;