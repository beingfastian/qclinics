import doctorModel from "../model/doctorModel.js";
import { listAppointments, parseListQuery, LIST_PROJECTION } from "../services/appointmentListService.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import appointmentModel from "../model/appointmentModel.js";
import { profitReport, ProfitError, visitSplit } from "../services/profitService.js";
import leaveRequestModel from "../model/leaveRequestModel.js";
import { createNotification } from "./notificationController.js";
import { formatSlotDate } from "../utils/slots.js";
import { todaySummary } from "../services/todayService.js";
import {
  AppointmentError,
  completeAppointment,
  cancelAppointment,
  bookFollowUp,
  queueBookingNotifications,
  upcomingLeaves,
  markNoShow,
} from "../services/appointmentService.js";

const changeAvailabilities = async (req, res) => {
  try {
    const { docId } = req.body;
    const docData = await doctorModel.findById(docId);
    if (!docData) {
      return res.json({ success: false, message: "Doctor not found" });
    }
    await doctorModel.findByIdAndUpdate(docId, {
      available: !docData.available,
    });
    res.json({ success: true, message: "Availability Changed Successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

const doctorList = async (req, res) => {
  try {
    // Public (patient website): no login details, personal WhatsApp numbers or booked slots
    const doctors = await doctorModel
      .find({})
      .select(["-password", "-email", "-whatsappNumber", "-whatsappConsentAt", "-slots_booked", "-hospitalSharePercent", "-shareHistory"]);
    res.json({
      success: true,
      doctors,
      message: "Doctors List Fetched Successfully",
    });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API for doctor login
const loginDoctor = async (req, res) => {
  try {
    const { email, password } = req.body;
    const doctor = await doctorModel.findOne({ email });
    if (!doctor) {
      return res.json({ success: false, message: "Invalid Credentials" });
    }
    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) {
      return res.json({ success: false, message: "Invalid Credentials" });
    }
    const token = jwt.sign(
      { id: doctor._id, role: "doctor" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );
    res.json({ success: true, token });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get doctor Appointments for doctor panel
const appointmentsDoctor = async (req, res) => {
  try {
    const { docId } = req.body;
    // With ?range= (or ?day=): one page of this doctor's appointments, filtered in the database
    if (req.query.range || req.query.day) {
      return res.json({ success: true, paged: true, ...(await listAppointments({ ...parseListQuery(req.query), docId })) });
    }
    const appointments = await appointmentModel.find({ docId }, LIST_PROJECTION).lean();

    if (!appointments) {
      return res.json({ success: false, message: "No appointments found" });
    }
    res.json({ success: true, appointments });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to mark appointment complete for doctor panel
const appointmentComplete = async (req, res) => {
  try {
    const { docId, appointmentId } = req.body;
    const appointmentData = await appointmentModel.findById(appointmentId);
    if (!appointmentData || appointmentData.docId !== docId) {
      return res.json({ success: false, message: "Appointment not found" });
    }

    await completeAppointment(appointmentId, { role: "doctor", id: docId });

    // Notify admin
    const notification = await createNotification(
      'admin', 'admin', docId, 'doctor',
      'appointment_completed',
      'Appointment Completed',
      `Dr. ${req.doctor.name} has completed an appointment with ${appointmentData.userData.name}.`,
      'medium',
      appointmentId
    );
    req.app.get('io')?.to('admin').emit('newNotification', notification);

    res.json({ success: true, message: "Appointment Completed" });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};


// API to cancel appointment for doctor panel
const appointmentCancel = async (req, res) => {
  try {
    const { docId, appointmentId, reason } = req.body;
    const appointmentData = await appointmentModel.findById(appointmentId);
    if (!appointmentData || appointmentData.docId !== docId) {
      return res.json({ success: false, message: "Appointment not found" });
    }

    await cancelAppointment(appointmentId, { role: "doctor", id: docId }, { reason, cancelledBy: "your doctor" });
    res.json({ success: true, message: "Appointment Cancelled" });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to mark appointment as no-show for doctor panel (patient never came)
const appointmentNoShow = async (req, res) => {
  try {
    const { docId, appointmentId } = req.body;
    const appointmentData = await appointmentModel.findById(appointmentId);
    if (!appointmentData || appointmentData.docId !== docId) {
      return res.json({ success: false, message: "Appointment not found" });
    }

    await markNoShow(appointmentId, { role: "doctor", id: docId });
    res.json({ success: true, message: "Marked as no-show" });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// Doctor schedules a follow-up visit for the patient of one of their appointments
const scheduleFollowUp = async (req, res) => {
  try {
    const { appointmentId, slotDate, slotTime } = req.body;
    const { appointment, patient, doctor } = await bookFollowUp({
      parentAppointmentId: appointmentId,
      doctorId: req.doctorId,
      slotDate,
      slotTime,
    });

    // The doctor booked it, so only the patient gets a confirmation (sent in the background)
    const notificationsQueued = queueBookingNotifications(appointment, patient, doctor, { notifyDoctor: false });

    // Let the admin/reception know
    const notification = await createNotification(
      'admin', 'admin', req.doctorId, 'doctor',
      'new_appointment',
      'Follow-up Scheduled',
      `Dr. ${doctor.name} scheduled a follow-up for ${patient.name} on ${formatSlotDate(appointment.slotDate)} at ${appointment.slotTime}.`,
      'medium',
      appointment._id.toString()
    );
    req.app.get('io')?.to('admin').emit('newNotification', notification);

    res.json({
      success: true,
      message: "Follow-up scheduled",
      appointment,
      patientNotified: notificationsQueued.patient.length > 0,
    });
  } catch (error) {
    if (!(error instanceof AppointmentError)) console.error(error);
    res.json({ success: false, message: error.message });
  }
};


// API to get dashboard data for doctor panel
const doctorDashboard = async (req, res) => {
  try {
    const { docId } = req.body;
    const appointments = await appointmentModel.find({ docId });
    const me = await doctorModel.findById(docId).select("hospitalSharePercent").lean();

    // The doctor's own earnings: their part of each completed visit's fee (after the
    // hospital's share). Fees = what patients paid in total.
    let earnings = 0;
    let fees = 0;
    for (const item of appointments) {
      if (!item.isCompleted) continue;
      const split = visitSplit(item, me?.hospitalSharePercent);
      earnings += split.doctor;
      fees += split.hospital + split.doctor;
    }

    let patients = [];

    appointments.map((item) => {
      if (!patients.includes(item.userId)) {
        patients.push(item.userId);
      }
    });

    const dashData = {
      earnings,
      fees,
      hospitalSharePercent: me?.hospitalSharePercent ?? 0,
      appointments: appointments.length,
      patients: patients.length,
      // Additive: how many patients never came (for the no-show pitch number)
      noShow: appointments.filter((item) => item.status === "no_show").length,
      latestAppointments: appointments.reverse().slice(0, 5),
      // Additive: today's numbers for this doctor (to see, seen, queue)
      today: (await todaySummary({ docId })).doctors[0] || null,
    };

    res.json({ success: true, dashData });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get doctor profile for doctor panel
const doctorProfile = async (req, res) => {
  try {
    const { docId } = req.body;
    const profileData = await doctorModel.findById(docId).select("-password").lean();
    // Upcoming approved leave, so the follow-up/reschedule pickers can hide those days
    const leaves = await upcomingLeaves([docId]);
    res.json({ success: true, profileData: profileData && { ...profileData, leaves: leaves.get(docId) || [] } });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// API to update doctor profile for doctor panel
const updateDoctorProfile = async (req, res) => {
  try {
    const { docId, fee, address, available } = req.body;
    await doctorModel.findByIdAndUpdate(docId, { fee, address, available });
    res.json({ success: true, message: "Profile Updated Successfully" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// Doctor applies for leave
const requestLeave = async (req, res) => {
  try {
    const doctorId = req.doctorId;
    const { fromDate, toDate, reason, type } = req.body;

    if (!doctorId) {
      return res.json({ success: false, message: "Doctor not authenticated" });
    }
    
    if (!fromDate || !toDate || !reason) {
      return res.json({ success: false, message: "All fields are required" });
    }
    
    // Validate dates
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (from < today) {
      return res.json({ success: false, message: "From date cannot be in the past" });
    }
    
    if (to < from) {
      return res.json({ success: false, message: "To date must be after from date" });
    }
    
    // Check for overlapping leave requests
    const overlap = await leaveRequestModel.findOne({
      doctorId,
      status: { $ne: "rejected" },
      $or: [
        { 
          fromDate: { $lte: new Date(toDate) }, 
          toDate: { $gte: new Date(fromDate) } 
        },
      ],
    });
    
    if (overlap) {
      return res.json({
        success: false,
        message: "Leave request overlaps with existing request",
      });
    }
    
    // Create leave request
    const leaveRequest = await leaveRequestModel.create({
      doctorId,
      fromDate: new Date(fromDate),
      toDate: new Date(toDate),
      reason,
      type: type || "vacation",
    });
    
    // Get doctor details for notification
    const doctor = await doctorModel.findById(doctorId);
    
    // Create notification for admin
    const notification = await createNotification(
      'admin',                    // recipient
      'admin',                    // recipientType
      doctorId,                   // sender (doctor ID)
      'doctor',                   // senderType
      'leave_request',            // type
      'New Leave Request',        // title
      `Dr. ${doctor.name} has requested leave from ${from.toLocaleDateString()} to ${to.toLocaleDateString()}.`, // message
      'high',                     // priority
      leaveRequest._id.toString() // relatedId
    );
    
    // Emit notification via Socket.IO to admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('newNotification', notification);
    }
    
    res.json({ success: true, message: "Leave request submitted successfully" });
  } catch (error) {
    console.error('Error in requestLeave:', error);
    res.json({ success: false, message: error.message });
  }
};



// List doctor's leave requests
const listLeaveRequests = async (req, res) => {
  try {
    const doctorId = req.doctorId;
    const leaveRequests = await leaveRequestModel
      .find({ doctorId })
      .sort({ submittedAt: -1 });
    res.json({ success: true, leaveRequests });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// Cancel a pending leave request
const cancelLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const leave = await leaveRequestModel.findById(id);
    if (!leave || leave.doctorId !== req.doctorId || leave.status !== "pending") {
      return res.json({ success: false, message: "Cannot cancel this leave request" });
    }
    await leaveRequestModel.findByIdAndDelete(id);
    res.json({ success: true, message: "Leave request cancelled" });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
};

// Add this to your existing exports
const getDoctorProfile = async (req, res) => {
  try {
    const doctorId = req.doctorId;
    const doctorData = await doctorModel.findById(doctorId).select("-password");
    
    if (!doctorData) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }
    
    // Fix image URL - only prepend server URL if it's not already a full URL
    if (doctorData.image) {
      // If image is already a full URL (starts with http), use it as is
      if (doctorData.image.startsWith('http://') || doctorData.image.startsWith('https://')) {
        // Do nothing, keep the URL as is
      } 
      // If it's a relative path, prepend the server URL
      else {
        doctorData.image = `${req.protocol}://${req.get('host')}/${doctorData.image}`;
      }
    }
    
    res.json({ success: true, doctorData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// API: the doctor's own earnings by day/week/month (their share and the hospital's)
const earningsReport = async (req, res) => {
  try {
    const { from, to, groupBy } = req.query;
    const report = await profitReport({ from, to, groupBy, docId: req.doctorId });
    res.json({ success: true, report });
  } catch (error) {
    if (!(error instanceof ProfitError)) console.error(error);
    res.json({ success: false, message: error instanceof ProfitError ? error.message : "Could not load the report" });
  }
};

export {
  earningsReport,
  changeAvailabilities,
  doctorList,
  loginDoctor,
  appointmentsDoctor,
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
};