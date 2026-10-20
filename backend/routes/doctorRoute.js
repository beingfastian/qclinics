// Fixed doctorRoute.js - Ensure proper route configuration
import express from "express";
import {
  appointmentsDoctor,
  doctorList,
  loginDoctor,
  appointmentComplete,
  appointmentCancel,
  appointmentNoShow,
  doctorDashboard,
  doctorProfile,
  updateDoctorProfile,
  requestLeave,
  listLeaveRequests,
  cancelLeaveRequest,
  getDoctorProfile,
  scheduleFollowUp,
  earningsReport,
} from "../controllers/doctorController.js";
import authDoctor from "../middleware/authDoctor.js";
import { loginLimits } from "../middleware/rateLimit.js";
import { rescheduleOne, rescheduleWholeDay, cancelWholeDay } from "../controllers/rescheduleController.js";

const doctorRouter = express.Router();

// Public routes
doctorRouter.get("/list", doctorList);
doctorRouter.post("/login", loginLimits, loginDoctor);

// Protected routes (require authentication)
doctorRouter.get("/appointments", authDoctor, appointmentsDoctor);
doctorRouter.post("/complete-appointment", authDoctor, appointmentComplete);
doctorRouter.post("/cancel-appointment", authDoctor, appointmentCancel);
doctorRouter.post("/mark-no-show", authDoctor, appointmentNoShow);
doctorRouter.post("/follow-up", authDoctor, scheduleFollowUp);
doctorRouter.post("/reschedule-appointment", authDoctor, rescheduleOne("doctor"));
doctorRouter.post("/reschedule-day", authDoctor, rescheduleWholeDay("doctor"));
doctorRouter.post("/cancel-day", authDoctor, cancelWholeDay("doctor"));
doctorRouter.get("/dashboard", authDoctor, doctorDashboard);
doctorRouter.get("/earnings", authDoctor, earningsReport);
doctorRouter.get("/profile", authDoctor, doctorProfile);
doctorRouter.post("/update-profile", authDoctor, updateDoctorProfile);
doctorRouter.get("/get-profile", authDoctor, getDoctorProfile);
// Leave request routes with proper HTTP methods
doctorRouter.post("/request-leave", authDoctor, requestLeave);
doctorRouter.get("/leave-requests", authDoctor, listLeaveRequests);
doctorRouter.delete("/cancel-leave-request/:id", authDoctor, cancelLeaveRequest);

export default doctorRouter;