import express from "express";
import { login, forgotPassword, verifyOTP, resetPassword } from "../controllers/authController.js";
import { loginLimits, passwordResetLimits } from "../middleware/rateLimit.js";

const router = express.Router();

// One sign-in for admin, doctors and lab staff
router.post("/login", loginLimits, login);

// Forgot password
router.post("/forgot-password", passwordResetLimits, forgotPassword);

// Verify OTP
router.post("/verify-otp", passwordResetLimits, verifyOTP);

// Reset password
router.post("/reset-password", passwordResetLimits, resetPassword);

export default router;