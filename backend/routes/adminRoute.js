import express from "express";
import {
  addDoctor,
  updateDoctor,
  deleteDoctor,
  allDoctors,
  loginAdmin,
  appointmentsAdmin,
  appointmentCancel,
  appointmentNoShow,
  adminDashboard,
  addPatient,
  getAllPatients,
  updatePatient,
  deletePatient,
  bookAppointmentForPatient,
  getWhatsAppStats,
  // Make sure these are imported correctly
  getAllLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  getLeaveStats,
  getSystemStatus,
  profit,
} from "../controllers/adminController.js";
import upload from "../middleware/multer.js";
import authAdmin from "../middleware/authAdmin.js";
import authDesk from "../middleware/authDesk.js";
import { loginLimits } from "../middleware/rateLimit.js";
import { changeAvailabilities } from "../controllers/doctorController.js";
import { rescheduleOne, rescheduleWholeDay, cancelWholeDay } from "../controllers/rescheduleController.js";

const adminRouter = express.Router();

// authDesk: the owner (admin login) or the shared reception login.
// authAdmin: the owner only (doctors, shares and fees, leave decisions, profit, settings).

// Authentication (public route)
adminRouter.post("/login", loginLimits, loginAdmin);

// Doctor Management Routes
adminRouter.post("/add-doctor", authAdmin, upload.single("image"), addDoctor);
adminRouter.put("/update-doctor/:doctorId", authAdmin, updateDoctor);
adminRouter.delete("/delete-doctor/:doctorId", authAdmin, deleteDoctor);
adminRouter.post("/all-doctors", authDesk, allDoctors);
adminRouter.post("/change-availability", authDesk, changeAvailabilities);

// Patient Management Routes
adminRouter.post("/add-patient", authDesk, upload.single("image"), addPatient);
adminRouter.get("/all-patients", authDesk, getAllPatients);
adminRouter.put("/update-patient/:patientId", authDesk, updatePatient);
adminRouter.delete("/delete-patient/:patientId", authAdmin, deletePatient);

// Appointment Management Routes
adminRouter.get("/appointments", authDesk, appointmentsAdmin);
adminRouter.post("/cancel-appointment", authDesk, appointmentCancel); // Fixed: removed 's'
adminRouter.post("/mark-no-show", authDesk, appointmentNoShow);
adminRouter.post("/book-appointment-for-patient", authDesk, bookAppointmentForPatient);
adminRouter.post("/reschedule-appointment", authDesk, rescheduleOne("admin"));
adminRouter.post("/reschedule-day", authDesk, rescheduleWholeDay("admin"));
adminRouter.post("/cancel-day", authDesk, cancelWholeDay("admin"));

// Leave Management Routes - Ensure these are properly defined
adminRouter.get("/leave-requests", authDesk, getAllLeaveRequests);
adminRouter.post("/approve-leave", authAdmin, approveLeaveRequest);
adminRouter.post("/reject-leave", authAdmin, rejectLeaveRequest);
adminRouter.get("/leave-stats", authDesk, getLeaveStats);

// Dashboard and Statistics
adminRouter.get("/dashboard", authDesk, adminDashboard);
adminRouter.get("/whatsapp-stats", authDesk, getWhatsAppStats);
adminRouter.get("/system-status", authAdmin, getSystemStatus);
adminRouter.get("/profit", authAdmin, profit);

export default adminRouter;