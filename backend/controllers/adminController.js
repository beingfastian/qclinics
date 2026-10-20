import validator from "validator";
import { sameSecret } from "../utils/secrets.js";
import { listAppointments, parseListQuery, LIST_PROJECTION } from "../services/appointmentListService.js";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v2 as cloudinary } from "cloudinary";
import doctorModel from "../model/doctorModel.js";
import jwt from "jsonwebtoken";
import appointmentModel from "../model/appointmentModel.js";
import userModel from "../model/userModel.js";
import leaveRequestModel from "../model/leaveRequestModel.js";
import { createNotification } from "./notificationController.js";
import { isEmailConfigured } from "../config/emailService.js";
import { isWhatsAppConfigured, getWhatsAppProvider } from "../config/whatsappService.js";
import { isCloudApiConfigured, getTemplateStatuses } from "../whatsapp/cloudApi.js";
import { LANGUAGES } from "../whatsapp/templates.js";
import { parsePercent, profitReport, ProfitError, visitSplit } from "../services/profitService.js";
import { releaseSlot, HOSPITAL_UTC_OFFSET_MINUTES, hospitalSlotDate } from "../utils/slots.js";
import { queueTokenModel } from "../model/queueModel.js";
import { todaySummary } from "../services/todayService.js";
import {
  AppointmentError,
  validateSlot,
  bookAppointment,
  queueBookingNotifications,
  cancelAppointment,
  getLeaveConflicts,
  upcomingLeaves,
  markNoShow,
} from "../services/appointmentService.js";

// API for adding doctors
const addDoctor = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      speciality,
      experience,
      about,
      fee,
      degree,
      address,
      whatsappEnabled,
      whatsappNumber,
      timings,
      sittingDays,
      holidays,
      hospitalSharePercent
    } = req.body;

    const imageFile = req.file;
    let sharePercent;
    try {
      sharePercent = parsePercent(hospitalSharePercent ?? 0);
    } catch (error) {
      return res.json({ success: false, message: error.message });
    }

    // Check for all data to add doctor
    if (
      !name ||
      !email ||
      !password ||
      !speciality ||
      !about ||
      !fee ||
      !degree ||
      !address ||
      !experience
    ) {
      return res.json({ success: false, message: "Please Fill All Fields" });
    }
    if (!validator.isEmail(email)) {
      return res.json({
        success: false,
        message: "Please Enter a valid Email",
      });
    }
    if (password.length < 8) {
      return res.json({
        success: false,
        message: "Password should be at least 8 characters long",
      });
    }
    if (!imageFile) {
      return res.json({ success: false, message: "Doctor image is required" });
    }

    // Check if doctor with email already exists
    const existingDoctor = await doctorModel.findOne({ email });
    if (existingDoctor) {
      return res.json({ success: false, message: "Doctor with this email already exists" });
    }

    // Hashing doctor password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Upload Image to cloudinary server
    const imageUpload = await cloudinary.uploader.upload(imageFile.path, {
      resource_type: "image",
    });

    const imageUrl = imageUpload.secure_url;

    const doctorData = {
      name,
      email,
      image: imageUrl,
      password: hashedPassword,
      speciality,
      degree,
      experience,
      about,
      fee,
      address: JSON.parse(address),
      date: Date.now(),
      // --- New fields ---
      whatsappEnabled: whatsappEnabled === 'true' || whatsappEnabled === true,
      whatsappNumber: whatsappNumber || "",
      ...((whatsappEnabled === 'true' || whatsappEnabled === true) && { whatsappConsentAt: new Date() }),
      timings: timings ? JSON.parse(timings) : { start: "09:00", end: "17:00" },
      sittingDays: sittingDays ? JSON.parse(sittingDays) : [],
      holidays: holidays || "",
      hospitalSharePercent: sharePercent,
      shareHistory: [{ percent: sharePercent, from: new Date(), by: "admin" }]
    };

    const newDoctor = new doctorModel(doctorData);
    await newDoctor.save();

    res.json({ success: true, message: "Doctor Added Successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to update doctor
const updateDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const {
      name,
      email,
      experience,
      fee,
      about,
      speciality,
      degree,
      address,
      available,
      hospitalSharePercent,
      timings,
      sittingDays
    } = req.body;

    let sharePercent;
    if (hospitalSharePercent !== undefined && hospitalSharePercent !== "") {
      try {
        sharePercent = parsePercent(hospitalSharePercent);
      } catch (error) {
        return res.json({ success: false, message: error.message });
      }
    }

    // Working hours and days are optional here; when sent, both must be valid
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    if (timings !== undefined) {
      if (!HHMM.test(timings?.start || "") || !HHMM.test(timings?.end || "") || timings.start >= timings.end) {
        return res.json({ success: false, message: "Working hours must have a start time before the end time" });
      }
    }
    if (sittingDays !== undefined) {
      if (!Array.isArray(sittingDays) || sittingDays.length === 0 || sittingDays.some((d) => !WEEK.includes(d))) {
        return res.json({ success: false, message: "Please select at least one working day" });
      }
    }

    // Validate input
    if (!name || !email || !experience || !fee || !about || !speciality || !degree || !address) {
      return res.json({ success: false, message: "Please fill all required fields" });
    }

    if (!validator.isEmail(email)) {
      return res.json({ success: false, message: "Please enter a valid email" });
    }

    // Check if doctor exists
    const doctor = await doctorModel.findById(doctorId);
    if (!doctor) {
      return res.json({ success: false, message: "Doctor not found" });
    }

    // Check if email is taken by another doctor
    const emailExists = await doctorModel.findOne({
      email,
      _id: { $ne: doctorId }
    });
    if (emailExists) {
      return res.json({ success: false, message: "Email already taken by another doctor" });
    }

    // Update doctor
    await doctorModel.findByIdAndUpdate(doctorId, {
      name,
      email,
      experience,
      fee: Number(fee),
      about,
      speciality,
      degree,
      address,
      available: available !== undefined ? available : doctor.available,
      ...(timings !== undefined && { timings: { start: timings.start, end: timings.end } }),
      ...(sittingDays !== undefined && { sittingDays }),
      // A new share applies to visits completed from now on; past visits keep theirs
      ...(sharePercent !== undefined && sharePercent !== (doctor.hospitalSharePercent ?? 0) && {
        hospitalSharePercent: sharePercent,
        $push: { shareHistory: { percent: sharePercent, from: new Date(), by: "admin" } },
      }),
    });

    // Upcoming bookings stay as they are; tell the admin how many no longer fit the new schedule
    let outsideSchedule = 0;
    if (timings !== undefined || sittingDays !== undefined) {
      const schedule = {
        name,
        available: true,
        timings: timings ?? doctor.timings,
        sittingDays: sittingDays ?? doctor.sittingDays,
      };
      const upcoming = await appointmentModel.find({
        docId: doctorId,
        cancelled: { $ne: true },
        isCompleted: { $ne: true },
        status: { $ne: "no_show" },
        startAt: { $gt: new Date() },
      }).select("slotDate slotTime");
      for (const apt of upcoming) {
        try {
          validateSlot(schedule, apt.slotDate, apt.slotTime, new Date(0));
        } catch (error) {
          if (!(error instanceof AppointmentError)) throw error;
          outsideSchedule += 1;
        }
      }
    }

    res.json({
      success: true,
      message: "Doctor updated successfully",
      outsideSchedule,
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

const getAllLeaveRequests = async (req, res) => {
  try {
    const leaveRequests = await leaveRequestModel.find({}).sort({ submittedAt: -1 });

    // doctorId is stored as a String, so load all referenced doctors in one query
    const doctorIds = [...new Set(leaveRequests.map((r) => r.doctorId))];
    const doctors = await doctorModel
      .find({ _id: { $in: doctorIds } })
      .select('name email speciality image');
    const doctorsById = new Map(doctors.map((d) => [d._id.toString(), d]));

    // Booked appointments that clash with pending or approved, not-yet-finished leave
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const requestsWithDoctorData = await Promise.all(leaveRequests.map(async (request) => ({
      ...request.toObject(),
      doctorData: doctorsById.get(request.doctorId) || null,
      conflicts: request.status !== "rejected" && request.toDate >= today
        ? await getLeaveConflicts(request)
        : [],
    })));

    res.json({
      success: true,
      leaveRequests: requestsWithDoctorData
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// Updated approveLeaveRequest function
const approveLeaveRequest = async (req, res) => {
  try {
    const { requestId, adminResponse } = req.body;

    if (!requestId) {
      return res.json({ success: false, message: "Request ID is required" });
    }

    const leaveRequest = await leaveRequestModel.findById(requestId);

    if (!leaveRequest) {
      return res.json({ success: false, message: "Leave request not found" });
    }

    if (leaveRequest.status !== 'pending') {
      return res.json({ success: false, message: "Leave request is not pending" });
    }

    await leaveRequestModel.findByIdAndUpdate(requestId, {
      status: 'approved',
      adminResponse: adminResponse || 'Leave request approved',
      approvedBy: 'admin',
      approvedAt: new Date()
    });

    // Get doctor info for notification
    const doctor = await doctorModel.findById(leaveRequest.doctorId);

    // Create notification for doctor
    const notification = await createNotification(
      leaveRequest.doctorId,     // recipient
      'doctor',                  // recipientType
      'admin',                   // sender
      'admin',                   // senderType
      'leave_approved',          // type
      'Leave Request Approved',   // title
      `Your leave request from ${new Date(leaveRequest.fromDate).toLocaleDateString()} to ${new Date(leaveRequest.toDate).toLocaleDateString()} has been approved.`, // message
      'high',                    // priority
      requestId                  // relatedId
    );

    // Emit notification via Socket.IO to doctor
    const io = req.app.get('io');
    if (io) {
      io.to(`doctor_${leaveRequest.doctorId}`).emit('newNotification', notification);
    }

    res.json({ success: true, message: "Leave request approved successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to reject leave request
// Updated rejectLeaveRequest function
const rejectLeaveRequest = async (req, res) => {
  try {
    const { requestId, adminResponse } = req.body;

    if (!requestId) {
      return res.json({ success: false, message: "Request ID is required" });
    }

    if (!adminResponse || adminResponse.trim() === '') {
      return res.json({ success: false, message: "Rejection reason is required" });
    }

    const leaveRequest = await leaveRequestModel.findById(requestId);

    if (!leaveRequest) {
      return res.json({ success: false, message: "Leave request not found" });
    }

    if (leaveRequest.status !== 'pending') {
      return res.json({ success: false, message: "Leave request is not pending" });
    }

    await leaveRequestModel.findByIdAndUpdate(requestId, {
      status: 'rejected',
      adminResponse,
      approvedBy: 'admin',
      approvedAt: new Date()
    });

    // Get doctor info for notification
    const doctor = await doctorModel.findById(leaveRequest.doctorId);

    // Create notification for doctor
    const notification = await createNotification(
      leaveRequest.doctorId,     // recipient
      'doctor',                  // recipientType
      'admin',                   // sender
      'admin',                   // senderType
      'leave_rejected',          // type
      'Leave Request Rejected',   // title
      `Your leave request has been rejected. Reason: ${adminResponse}`, // message
      'high',                    // priority
      requestId                  // relatedId
    );

    // Emit notification via Socket.IO to doctor
    const io = req.app.get('io');
    if (io) {
      io.to(`doctor_${leaveRequest.doctorId}`).emit('newNotification', notification);
    }

    res.json({ success: true, message: "Leave request rejected successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get leave requests statistics
const getLeaveStats = async (req, res) => {
  try {
    const totalRequests = await leaveRequestModel.countDocuments({});
    const pendingRequests = await leaveRequestModel.countDocuments({ status: 'pending' });
    const approvedRequests = await leaveRequestModel.countDocuments({ status: 'approved' });
    const rejectedRequests = await leaveRequestModel.countDocuments({ status: 'rejected' });

    // Get current month's requests
    const currentMonth = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    const monthlyRequests = await leaveRequestModel.countDocuments({
      submittedAt: { $gte: startOfMonth, $lte: endOfMonth }
    });

    res.json({
      success: true,
      stats: {
        total: totalRequests,
        pending: pendingRequests,
        approved: approvedRequests,
        rejected: rejectedRequests,
        thisMonth: monthlyRequests
      }
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to delete doctor
const deleteDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if doctor exists
    const doctor = await doctorModel.findById(doctorId);
    if (!doctor) {
      return res.json({ success: false, message: "Doctor not found" });
    }

    // Check for upcoming appointments (past visits nobody closed and no-shows
    // don't block deleting; records from before startAt existed still count)
    const activeAppointments = await appointmentModel.find({
      docId: doctorId,
      cancelled: false,
      isCompleted: false,
      status: { $ne: "no_show" },
      $or: [{ startAt: { $gt: new Date() } }, { startAt: { $exists: false } }],
    });

    if (activeAppointments.length > 0) {
      return res.json({
        success: false,
        message: `Cannot delete doctor. There are ${activeAppointments.length} active appointments.`
      });
    }

    // Patients still waiting in this doctor's live queue today would be left in a
    // line nobody can see
    const stillInQueue = await queueTokenModel.countDocuments({
      docId: doctorId,
      day: hospitalSlotDate(new Date()),
      status: { $in: ["waiting", "called", "skipped"] },
    });
    if (stillInQueue) {
      return res.json({
        success: false,
        message: `Cannot delete doctor. ${stillInQueue} patient(s) are still in today's queue. Finish or remove them in Live Queue first.`,
      });
    }

    // Delete doctor
    await doctorModel.findByIdAndDelete(doctorId);

    res.json({ success: true, message: "Doctor deleted successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API for adding patients
const addPatient = async (req, res) => {
  try {
    const {
      name,
      cnic,
      phone,
      email,
      dob,
      gender,
      address,
      whatsappEnabled,
      whatsappNumber,
      language
    } = req.body;
    const imageFile = req.file;
    const patientEmail = (email || "").trim();

    // Validate required fields
    if (!name || !cnic || !phone || !dob || !address) {
      return res.json({ success: false, message: "Please fill all required fields" });
    }

    // Validate CNIC
    if (!/^\d{13}$/.test(cnic)) {
      return res.json({ success: false, message: "CNIC must be exactly 13 digits" });
    }

    if (patientEmail && !validator.isEmail(patientEmail)) {
      return res.json({ success: false, message: "Please enter a valid email" });
    }

    // Same person = same CNIC (or email). A shared family phone is allowed.
    const existingUser = await userModel.findOne({
      $or: [{ cnic }, ...(patientEmail ? [{ email: patientEmail }] : [])]
    });
    if (existingUser) {
      return res.json({ success: false, message: `A patient with this CNIC or email already exists (${existingUser.name})` });
    }

    // Upload image if provided
    let imageUrl = null;
    if (imageFile) {
      const imageUpload = await cloudinary.uploader.upload(imageFile.path, {
        resource_type: "image",
      });
      imageUrl = imageUpload.secure_url;
    }

    const patientData = {
      name,
      cnic,
      phone,
      dob,
      gender: gender || "Male",
      address: JSON.parse(address),
      whatsappEnabled: whatsappEnabled === 'true' || whatsappEnabled === true,
      whatsappNumber: whatsappNumber || phone,
      ...((whatsappEnabled === 'true' || whatsappEnabled === true) && { whatsappConsentAt: new Date() }),
      ...(LANGUAGES.includes(language) && { language }),
      ...(patientEmail && { email: patientEmail }),
      ...(imageUrl && { image: imageUrl })
    };

    const newPatient = new userModel(patientData);
    await newPatient.save();

    // Create notification for admin
    const notification = await createNotification(
      'admin',                    // recipient
      'admin',                    // recipientType
      'admin',                   // sender
      'admin',                   // senderType
      'new_patient',             // type
      'New Patient Registered',  // title
      `New patient ${name} has been registered in the system.`, // message
      'medium',                  // priority
      newPatient._id.toString()  // relatedId
    );

    // Emit notification via Socket.IO to admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('newNotification', notification);
    }

    res.json({ success: true, message: "Patient added successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};


// API to get all patients.
// With ?limit=: one page (oldest first, as the screen listed them), filtered in the
// database with the same rules the Manage Patients screen used in the browser:
//   q         name, email or phone (any part, any case), or part of the CNIC
//   gender    Male | Female | Other
//   whatsapp  enabled | disabled
// plus `total` (all matches) and `nextCursor`. Without ?limit: every patient, for
// screens still running the previous version.
const PATIENT_PAGE_MAX = 200;
const getAllPatients = async (req, res) => {
  try {
    if (req.query.limit) {
      const limit = Math.min(PATIENT_PAGE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const filter = {};
      const text = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
      if (text) {
        const literal = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // typed text, never a pattern
        const pattern = new RegExp(literal, "i");
        const exact = new RegExp(literal); // CNIC: as the screen matched it (digits)
        filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { cnic: exact }];
      }
      if (["Male", "Female", "Other"].includes(req.query.gender)) filter.gender = req.query.gender;
      if (req.query.whatsapp === "enabled") filter.whatsappEnabled = true;
      if (req.query.whatsapp === "disabled") filter.whatsappEnabled = false;
      const after = mongoose.isValidObjectId(req.query.cursor) ? new mongoose.Types.ObjectId(String(req.query.cursor)) : null;
      const [rows, total] = await Promise.all([
        userModel
          .find(after ? { $and: [filter, { _id: { $gt: after } }] } : filter)
          .select("-password")
          .sort({ _id: 1 })
          .limit(limit + 1)
          .lean(),
        after ? Promise.resolve(undefined) : userModel.countDocuments(filter),
      ]);
      const patients = rows.slice(0, limit);
      return res.json({
        success: true,
        patients,
        ...(total !== undefined && { total }),
        nextCursor: rows.length > limit ? String(patients.at(-1)._id) : null,
      });
    }
    const patients = await userModel.find({}).select("-password");
    res.json({ success: true, patients });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to update patient
const updatePatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const {
      name,
      email,
      phone,
      dob,
      gender,
      address,
      whatsappEnabled,
      whatsappNumber,
      language
    } = req.body;

    // Validate input
    if (!name || !phone || !dob || !gender) {
      return res.json({ success: false, message: "Please fill all required fields" });
    }

    // Email is optional (patients added by admin usually have none)
    const trimmedEmail = (email || "").trim();
    if (trimmedEmail && !validator.isEmail(trimmedEmail)) {
      return res.json({ success: false, message: "Please enter a valid email" });
    }

    // Check if patient exists
    const patient = await userModel.findById(patientId);
    if (!patient) {
      return res.json({ success: false, message: "Patient not found" });
    }

    // Check if email is taken by another patient
    if (trimmedEmail) {
      const emailExists = await userModel.findOne({
        email: trimmedEmail,
        _id: { $ne: patientId }
      });
      if (emailExists) {
        return res.json({ success: false, message: "Email already taken by another patient" });
      }
    }

    // Update patient. An empty email is removed rather than stored as "",
    // because the unique index would treat "" as a duplicate value.
    // WhatsApp consent: keep the original date while enabled, clear it when disabled.
    const whatsappOn = whatsappEnabled === 'true' || whatsappEnabled === true;
    const unset = {
      ...(!trimmedEmail && { email: 1 }),
      ...(!whatsappOn && { whatsappConsentAt: 1 }),
    };
    await userModel.findByIdAndUpdate(patientId, {
      ...(trimmedEmail && { email: trimmedEmail }),
      ...(whatsappOn && !patient.whatsappConsentAt && { whatsappConsentAt: new Date() }),
      ...(Object.keys(unset).length && { $unset: unset }),
      name,
      phone,
      dob,
      gender,
      address,
      whatsappEnabled: whatsappOn,
      whatsappNumber: whatsappNumber || phone,
      ...(LANGUAGES.includes(language) && { language })
    });

    res.json({ success: true, message: "Patient updated successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to delete patient
const deletePatient = async (req, res) => {
  try {
    const { patientId } = req.params;

    // Check if patient exists
    const patient = await userModel.findById(patientId);
    if (!patient) {
      return res.json({ success: false, message: "Patient not found" });
    }

    // Free the slots of upcoming appointments, then delete all appointments for this patient
    const activeAppointments = await appointmentModel.find({
      userId: patientId,
      cancelled: false,
      isCompleted: false
    });
    for (const apt of activeAppointments) {
      await releaseSlot(apt.docId, apt.slotDate, apt.slotTime);
    }
    await appointmentModel.deleteMany({ userId: patientId });

    // Delete patient
    await userModel.findByIdAndDelete(patientId);

    res.json({ success: true, message: "Patient and associated appointments deleted successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to book appointment for patient (admin booking)
// adminController.js - Enhanced bookAppointmentForPatient function

const bookAppointmentForPatient = async (req, res) => {
  try {
    const {
      patientSelectionMode,
      selectedPatientId,
      newPatientData,
      docId,
      slotDate,
      slotTime,
      discountPercent,
      finalFee
    } = req.body;

    // Check the doctor and slot before creating anything
    const docData = docId && await doctorModel.findById(docId).select("-password");
    if (!docData) {
      return res.json({ success: false, message: "Please select a doctor" });
    }
    validateSlot(docData, slotDate, slotTime);

    let patientId = selectedPatientId;
    let userData;

    // Handle new patient creation
    if (patientSelectionMode === "new") {
      const { name, phone, cnic, dob, gender, address, whatsappEnabled, whatsappNumber, language } = newPatientData;
      const patientEmail = (newPatientData.email || "").trim();
      if (patientEmail && !validator.isEmail(patientEmail)) {
        return res.json({ success: false, message: "Please enter a valid email" });
      }

      if (!name || !phone || !cnic || !dob || !address?.line1) {
        return res.json({ success: false, message: "Please fill all required patient fields" });
      }

      if (!/^\d{13}$/.test(cnic)) {
        return res.json({ success: false, message: "CNIC must be exactly 13 digits" });
      }

      // Same person = same CNIC (or email). A shared family phone is allowed.
      const existingUser = await userModel.findOne({
        $or: [{ cnic }, ...(patientEmail ? [{ email: patientEmail }] : [])]
      });
      if (existingUser) {
        return res.json({ success: false, message: `A patient with this CNIC or email already exists (${existingUser.name}). Select them as an existing patient.` });
      }

      const patientData = {
        ...(patientEmail && { email: patientEmail }),
        name,
        cnic,
        phone,
        dob,
        gender,
        address,
        whatsappEnabled: whatsappEnabled || false,
        whatsappNumber: whatsappNumber || phone,
        ...(whatsappEnabled && { whatsappConsentAt: new Date() }),
        ...(LANGUAGES.includes(language) && { language })
      };

      const newPatient = new userModel(patientData);
      const savedPatient = await newPatient.save();
      patientId = savedPatient._id.toString();
      userData = savedPatient.toObject();
      console.log('✅ New patient created:', userData.name);
    } else {
      // Use existing patient
      userData = await userModel.findById(selectedPatientId).select("-password");
      if (!userData) {
        return res.json({ success: false, message: "Selected patient not found" });
      }
      console.log('✅ Using existing patient:', userData.name);
    }

    // The fee is worked out here from the doctor's fee and the discount, so what is
    // stored, sent on WhatsApp and printed on the slip always agree (a 100%
    // discount is a free visit, not the full fee)
    const percent = Math.min(100, Math.max(0, Number(discountPercent) || 0));
    const fee = Math.round(((Number(docData.fee) || 0) * (100 - percent)) / 100);

    const patient = userData.toObject ? userData : await userModel.findById(patientId).select("-password");
    const newAppointment = await bookAppointment({
      patient,
      doctor: docData,
      slotDate,
      slotTime,
      amount: fee,
      discountPercent: percent,
      finalFee: fee,
      actor: { role: "admin" },
    });

    // WhatsApp/email go out in the background; the response doesn't wait for them
    const notificationsQueued = queueBookingNotifications(newAppointment, patient, docData);

    res.json({
      success: true,
      message: patientSelectionMode === "new"
        ? "New patient created and appointment booked successfully"
        : "Appointment booked successfully",
      appointmentId: newAppointment._id.toString(),
      // What was booked, so the reception can print the patient's slip
      appointment: {
        _id: newAppointment._id.toString(),
        patientName: patient.name,
        slotDate: newAppointment.slotDate,
        slotTime: newAppointment.slotTime,
        amount: newAppointment.amount,
      },
      notificationsQueued,
    });

  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error('Booking error:', error);
    res.json({ success: false, message: error.message, code: error.code });
  }
};

// API for the admin login
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (
      email === process.env.ADMIN_EMAIL &&
      sameSecret(password, process.env.ADMIN_PASSWORD)
    ) {
      const token = jwt.sign(
        { role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );
      res.json({
        success: true,
        message: "Admin Logged in Successfully",
        token,
      });
    } else {
      res.json({ success: false, message: "Invalid Credentials" });
    }
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get all doctors list for admin panel
const allDoctors = async (req, res) => {
  try {
    const doctors = await doctorModel.find({}).select("-password").lean();
    // Upcoming approved leave, so booking screens can hide those days
    const leaves = await upcomingLeaves(doctors.map((d) => d._id.toString()));
    res.json({
      success: true,
      message: "Doctors Data Fetch Successfully",
      doctors: doctors.map((d) => ({ ...d, leaves: leaves.get(d._id.toString()) || [] })),
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get all Appointments list.
// With ?range= (or ?day=): one page, filtered in the database (services/appointmentListService.js).
// Without: every appointment, for staff screens still running the previous version.
const appointmentsAdmin = async (req, res) => {
  try {
    if (req.query.range || req.query.day) {
      return res.json({ success: true, paged: true, ...(await listAppointments(parseListQuery(req.query))) });
    }
    const appointments = await appointmentModel.find({}, LIST_PROJECTION).lean();
    res.json({ success: true, appointments });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to cancel appointment
const appointmentCancel = async (req, res) => {
  try {
    const { appointmentId, reason } = req.body;
    await cancelAppointment(appointmentId, { role: "admin" }, { reason, cancelledBy: "the hospital" });
    res.json({ success: true, message: "Appointment Cancelled" });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to mark a past appointment as no-show (patient never came)
const appointmentNoShow = async (req, res) => {
  try {
    const { appointmentId } = req.body;
    const updated = await markNoShow(appointmentId, { role: "admin" });
    res.json({ success: true, message: "Marked as no-show", appointment: updated });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};


// API to get WhatsApp statistics
const getWhatsAppStats = async (req, res) => {
  try {
    const enabledUsers = await userModel.countDocuments({ whatsappEnabled: true });

    // Get today's appointments with WhatsApp enabled users
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const todayAppointments = await appointmentModel.find({
      date: { $gte: startOfDay.getTime(), $lte: endOfDay.getTime() }
    });

    const todayNotifications = todayAppointments.filter(
      apt => apt.userData?.whatsappEnabled
    ).length;

    res.json({
      success: true,
      data: {
        enabledUsers,
        todayNotifications
      }
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to report which notification services are configured
const getSystemStatus = async (req, res) => {
  // Template review status, only for Kapso / Meta (Twilio sends plain text)
  let templates = null;
  let templatesError = null;
  if (isCloudApiConfigured() && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    try {
      templates = await getTemplateStatuses();
    } catch (error) {
      templatesError = error.message;
    }
  }
  res.json({
    success: true,
    status: {
      whatsappConfigured: isWhatsAppConfigured(),
      whatsappProvider: getWhatsAppProvider(),
      emailConfigured: isEmailConfigured(),
      remindersEnabled: process.env.REMINDERS_ENABLED !== "false" && isWhatsAppConfigured(),
      reminderDayBeforeAt: process.env.REMINDER_DAY_BEFORE_AT ?? "19:00",
      reminderMinutesBefore: Number(process.env.REMINDER_MINUTES_BEFORE ?? 60),
      templates,
      templatesError,
    },
  });
};

// Counts for one time range [startMs, endMs), used by the dashboard's
// "today" and "last 30 days" stats. Based on startAt (the real moment), so
// very old records saved before startAt existed are not counted.
// noShowRate = no-shows / (completed + no-shows): of the patients whose
// appointment time passed and who didn't cancel ahead, how many never came.
const appointmentStats = async ([startMs, endMs]) => {
  const rows = await appointmentModel
    .find({ startAt: { $gte: new Date(startMs), $lt: new Date(endMs) } })
    .select("status cancelled isCompleted")
    .lean();
  const stats = { total: rows.length, booked: 0, completed: 0, cancelled: 0, noShow: 0, noShowRate: 0 };
  for (const row of rows) {
    if (row.cancelled) stats.cancelled++;
    else if (row.isCompleted) stats.completed++;
    else if (row.status === "no_show") stats.noShow++;
    else stats.booked++;
  }
  const decided = stats.completed + stats.noShow;
  stats.noShowRate = decided ? Math.round((stats.noShow * 100) / decided) : 0;
  return stats;
};

// API to get dashboard data for admin panel
const adminDashboard = async (req, res) => {
  try {
    const [doctors, patients, appointments, latestAppointments, today, last30Days, todayDoctors, pendingLeave] = await Promise.all([
      doctorModel.countDocuments({}),
      userModel.countDocuments({}),
      appointmentModel.countDocuments({}),
      appointmentModel.find({}).sort({ date: -1 }).limit(5),
      appointmentStats(
        // Today in hospital time (Pakistan +5, no DST), as a UTC range
        (() => {
          const offsetMs = HOSPITAL_UTC_OFFSET_MINUTES * 60000;
          const start = Math.floor((Date.now() + offsetMs) / 86400000) * 86400000 - offsetMs;
          return [start, start + 86400000];
        })()
      ),
      appointmentStats([Date.now() - 30 * 86400000, Date.now()]),
      todaySummary(),
      leaveRequestModel.countDocuments({ status: "pending" }),
    ]);

    // Additive fields only: existing screens keep reading doctors/patients/appointments/latestAppointments
    const dashData = { doctors, patients, appointments, latestAppointments, today, last30Days, todayDoctors, pendingLeave };
    res.json({ success: true, dashData });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API: hospital profit by day/week/month, for one doctor or all
const profit = async (req, res) => {
  try {
    const { from, to, docId, groupBy } = req.query;
    if (docId && !mongoose.isValidObjectId(docId)) return res.json({ success: false, message: "Doctor not found" });
    res.json({ success: true, report: await profitReport({ from, to, docId, groupBy }) });
  } catch (error) {
    if (!(error instanceof ProfitError)) console.error(error);
    res.json({ success: false, message: error instanceof ProfitError ? error.message : "Could not load the report" });
  }
};

export {
  profit,
  addDoctor,
  updateDoctor,
  deleteDoctor,
  addPatient,
  getAllPatients,
  updatePatient,
  deletePatient,
  bookAppointmentForPatient,
  loginAdmin,
  allDoctors,
  appointmentsAdmin,
  appointmentCancel,
  appointmentNoShow,
  getWhatsAppStats,
  adminDashboard,
  // Add these new exports:
  getAllLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  getLeaveStats,
  getSystemStatus,
};