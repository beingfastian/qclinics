import { createContext, useState } from "react";
import axios from "axios";
export const AdminContext = createContext();
import { toast } from "react-toastify";
import { isOwnerToken } from "../billing/api";

const AdminContextProvider = (props) => {
  const [aToken, setAToken] = useState(
    localStorage.getItem("aToken") ? localStorage.getItem("aToken") : ""
  );
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  // Appointment lists load their own pages (utils/useAppointmentPages.js); this
  // number changes after an action so whatever list is on screen reloads
  const [appointmentsVersion, setAppointmentsVersion] = useState(0);
  const [dashData, setDashData] = useState(false);
  // Add leave requests state
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveStats, setLeaveStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    thisMonth: 0
  });
  
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  
  // ================= EXISTING FUNCTIONS (keep all your existing functions) =================
// Doctor CRUD
const getAllDoctors = async () => {
  try {
    const { data } = await axios.post(
      backendUrl + "/api/admin/all-doctors",
      {},
      { headers: { atoken: aToken } }   // ✅ fixed
    );
    if (data.success) {
      setDoctors(data.doctors);
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    toast.error(error.message);
  }
};

const changeAvailability = async (docId) => {
  try {
    const { data } = await axios.post(
      backendUrl + "/api/admin/change-availability",
      { docId },
      { headers: { atoken: aToken } }   // ✅ fixed
    );
    if (data.success) {
      toast.success(data.message);
      getAllDoctors();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    toast.error(error.message);
  }
};

// Patient CRUD
const getAllPatients = async () => {
  try {
    const { data } = await axios.get(
      backendUrl + "/api/admin/all-patients",
      { headers: { atoken: aToken } }   // ✅ fixed
    );
    if (data.success) {
      setPatients(data.patients);
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    toast.error(error.message);
  }
};

// Appointments: tell the list on screen to reload
const refreshAppointments = () => setAppointmentsVersion((v) => v + 1);

const cancelAppointment = async (appointmentId) => {
  try {
    const { data } = await axios.post(
      backendUrl + "/api/admin/cancel-appointment",
      { appointmentId },
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      toast.success(data.message);
      refreshAfterChange();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    toast.error(error.response?.data?.message || error.message);
  }
};

// Refresh everything that shows appointments or free slots
const refreshAfterChange = () => {
  getDashData();
  refreshAppointments();
  getAllDoctors();
};

const postAdmin = async (path, body) => {
  try {
    const { data } = await axios.post(backendUrl + path, body, { headers: { atoken: aToken } });
    if (!data.success) toast.error(data.message);
    return data;
  } catch (error) {
    toast.error(error.response?.data?.message || error.message);
    return { success: false };
  }
};

// Move one appointment to a new date/time (patient is told on WhatsApp)
const rescheduleAppointment = async (appointmentId, slotDate, slotTime, reason) => {
  const data = await postAdmin("/api/admin/reschedule-appointment", { appointmentId, slotDate, slotTime, reason });
  if (data.success) {
    toast.success(data.message);
    refreshAfterChange();
  } else {
    getAllDoctors(); // the slot may have just been taken; show fresh booked slots
  }
  return data.success;
};

// Move all of a doctor's appointments from one day to another
const rescheduleDay = async (docId, fromSlotDate, toSlotDate, reason) => {
  const data = await postAdmin("/api/admin/reschedule-day", { docId, fromSlotDate, toSlotDate, reason });
  if (!data.success) return null;
  refreshAfterChange();
  return data;
};

// Cancel all of a doctor's appointments on one day
const cancelDay = async (docId, slotDate, reason) => {
  const data = await postAdmin("/api/admin/cancel-day", { docId, slotDate, reason });
  if (!data.success) return null;
  refreshAfterChange();
  return data;
};

// Mark a past appointment as no-show (patient never came)
const markNoShow = async (appointmentId) => {
  try {
    const { data } = await axios.post(
      backendUrl + "/api/admin/mark-no-show",
      { appointmentId },
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      toast.success(data.message);
      getDashData();
      refreshAppointments();
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    toast.error(error.response?.data?.message || error.message);
  }
};

// Dashboard
// silent: background refresh, no error pop-ups on a weak connection
const getDashData = async ({ silent = false } = {}) => {
  try {
    const { data } = await axios.get(
      backendUrl + "/api/admin/dashboard",
      { headers: { atoken: aToken } }   // ✅ fixed
    );
    if (data.success) {
      setDashData(data.dashData);
    } else {
      if (!silent) toast.error(data.message);
    }
  } catch (error) {
    if (!silent) toast.error(error.message);
  }
};

// Leave Management
// Fixed leave management functions in AdminContext.jsx

const approveLeaveRequest = async (requestId, adminResponse = '') => {
  try {
    const { data } = await axios.post(
      backendUrl + "/api/admin/approve-leave",
      { requestId, adminResponse },
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      toast.success(data.message);
      getAllLeaveRequests();
      getLeaveStats();
    } else {
      toast.error(data.message);
    }
    return data;
  } catch (error) {
    console.error('Error approving leave:', error.response?.data || error.message);
    toast.error(error.response?.data?.message || "Failed to approve leave request");
    throw error;
  }
};

const rejectLeaveRequest = async (requestId, adminResponse) => {
  try {
    if (!adminResponse || adminResponse.trim() === '') {
      toast.error('Please provide a reason for rejection');
      return { success: false };
    }

    const { data } = await axios.post(
      backendUrl + "/api/admin/reject-leave",
      { requestId, adminResponse },
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      toast.success(data.message);
      getAllLeaveRequests();
      getLeaveStats();
    } else {
      toast.error(data.message);
    }
    return data;
  } catch (error) {
    console.error('Error rejecting leave:', error.response?.data || error.message);
    toast.error(error.response?.data?.message || "Failed to reject leave request");
    throw error;
  }
};

const getAllLeaveRequests = async () => {
  try {
    const { data } = await axios.get(
      backendUrl + "/api/admin/leave-requests",
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      setLeaveRequests(data.leaveRequests);
    } else {
      toast.error(data.message);
    }
  } catch (error) {
    console.error('Error fetching leave requests:', error.response?.data || error.message);
    toast.error("Failed to fetch leave requests");
  }
};

const getLeaveStats = async () => {
  try {
    const { data } = await axios.get(
      backendUrl + "/api/admin/leave-stats",
      { headers: { atoken: aToken } }
    );
    if (data.success) {
      setLeaveStats(data.stats);
    } else {
      console.error(data.message);
    }
  } catch (error) {
    console.error('Error fetching leave stats:', error.response?.data || error.message);
  }
};

  const value = {
    aToken,
    setAToken,
    // The owner (admin login), not the shared reception login
    isOwner: isOwnerToken(aToken),
    backendUrl,
    
    // Doctor CRUD
    doctors,
    getAllDoctors,
    changeAvailability,
    
    // Patient CRUD
    patients,
    getAllPatients,
    
    // Appointments
    appointmentsVersion,
    refreshAppointments,
    cancelAppointment,
    rescheduleAppointment,
    rescheduleDay,
    cancelDay,
    markNoShow,
    
    // Dashboard
    getDashData,
    dashData,

    // Leave Management (NEW)
    leaveRequests,
    getAllLeaveRequests,
    approveLeaveRequest,
    rejectLeaveRequest,
    leaveStats,
    getLeaveStats,
  };
  
  return (
    <AdminContext.Provider value={value}>
      {props.children}
    </AdminContext.Provider>
  );
};

export default AdminContextProvider;