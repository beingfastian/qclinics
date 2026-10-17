import { createContext, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

export const DoctorContext = createContext();

const DoctorContextProvider = (props) => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const [dToken, setDToken] = useState(
    localStorage.getItem("dToken") ? localStorage.getItem("dToken") : ""
  );
  const [dashData, setDashData] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [profileData, setProfileData] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]); 
  const [doctorData, setDoctorData] = useState(null); 

  const getAppointments = async () => {
    try {
      const { data } = await axios.get(
        backendUrl + "/api/doctor/appointments",
        { headers: { dToken } }
      );
      if (data.success) {
        setAppointments(data.appointments);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const completeAppointment = async (appointmentId) => {
    try {
      const { data } = await axios.post(
        backendUrl + "/api/doctor/complete-appointment",
        { appointmentId },
        { headers: { dToken } }
      );
      if (data.success) {
        toast.success(data.message);
        getAppointments();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.message);
    }
  };

  const cancelAppointment = async (appointmentId) => {
    try {
      const { data } = await axios.post(
        backendUrl + "/api/doctor/cancel-appointment",
        { appointmentId },
        { headers: { dToken } }
      );
      if (data.success) {
        toast.success(data.message);
        getAppointments();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Mark a past appointment as no-show (patient never came)
  const markNoShow = async (appointmentId) => {
    try {
      const { data } = await axios.post(
        backendUrl + "/api/doctor/mark-no-show",
        { appointmentId },
        { headers: { dToken } }
      );
      if (data.success) {
        toast.success(data.message);
        getAppointments();
        getDashData();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Book a follow-up visit for the patient of one of the doctor's appointments
  const scheduleFollowUp = async (appointmentId, slotDate, slotTime) => {
    try {
      const { data } = await axios.post(
        backendUrl + "/api/doctor/follow-up",
        { appointmentId, slotDate, slotTime },
        { headers: { dToken } }
      );
      if (data.success) {
        toast.success(
          data.patientNotified ? "Follow-up scheduled. The patient will be notified." : "Follow-up scheduled."
        );
        getAppointments();
        // The created appointment, so the caller can offer a printable slip
        return data.appointment || true;
      }
      toast.error(data.message);
      return false;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
      return false;
    }
  };

  const postDoctor = async (path, body) => {
    try {
      const { data } = await axios.post(backendUrl + path, body, { headers: { dToken } });
      if (!data.success) toast.error(data.message);
      return data;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
      return { success: false };
    }
  };

  // Move one of the doctor's appointments (patient is told on WhatsApp)
  const rescheduleAppointment = async (appointmentId, slotDate, slotTime, reason) => {
    const data = await postDoctor("/api/doctor/reschedule-appointment", { appointmentId, slotDate, slotTime, reason });
    if (data.success) {
      toast.success(data.message);
      getAppointments();
    }
    return data.success;
  };

  // Move all of the doctor's appointments from one day to another
  const rescheduleDay = async (_docId, fromSlotDate, toSlotDate, reason) => {
    const data = await postDoctor("/api/doctor/reschedule-day", { fromSlotDate, toSlotDate, reason });
    if (!data.success) return null;
    getAppointments();
    return data;
  };

  // Cancel all of the doctor's appointments on one day
  const cancelDay = async (_docId, slotDate, reason) => {
    const data = await postDoctor("/api/doctor/cancel-day", { slotDate, reason });
    if (!data.success) return null;
    getAppointments();
    return data;
  };

  // silent: background refresh, no error pop-ups on a weak connection
  const getDashData = async ({ silent = false } = {}) => {
    try {
      const { data } = await axios.get(backendUrl + "/api/doctor/dashboard", {
        headers: { dToken },
      });
      if (data.success) {
        setDashData(data.dashData);
      } else {
        if (!silent) toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      if (!silent) toast.error(error.message);
    }
  };

  const getProfileData = async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/doctor/profile", {
        headers: { dToken },
      });
      if (data.success) {
        setProfileData(data.profileData);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // NEW: Leave management functions
  const requestLeave = async (leaveData) => {
    try {
      const { data } = await axios.post(
        backendUrl + "/api/doctor/request-leave",
        leaveData,
        { 
          headers: { 
            dToken,
            'Content-Type': 'application/json'
          } 
        }
      );
      
      if (data.success) {
        toast.success(data.message);
        getLeaveRequests(); // Refresh leave requests
        return { success: true };
      } else {
        toast.error(data.message);
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('Error requesting leave:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to request leave';
      toast.error(errorMessage);
      return { success: false, message: errorMessage };
    }
  };

  const getLeaveRequests = async () => {
    try {
      const { data } = await axios.get(
        backendUrl + "/api/doctor/leave-requests",
        { headers: { dToken } }
      );
      
      if (data.success) {
        setLeaveRequests(data.leaveRequests);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Error getting leave requests:', error);
      toast.error(error.response?.data?.message || 'Failed to fetch leave requests');
    }
  };

  const cancelLeaveRequest = async (requestId) => {
    try {
      const { data } = await axios.delete(
        backendUrl + `/api/doctor/cancel-leave-request/${requestId}`,
        { headers: { dToken } }
      );
      
      if (data.success) {
        toast.success(data.message);
        getLeaveRequests(); // Refresh leave requests
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Error cancelling leave request:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel leave request');
    }
  };
   // Get doctor profile data
  const getDoctorProfile = async () => {
    try {
      const { data } = await axios.get(
        backendUrl + "/api/doctor/get-profile",
        { headers: { dToken } }
      );
      
      if (data.success) {
        setDoctorData(data.doctorData);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error("Error fetching doctor profile:", error);
      toast.error(error.response?.data?.message || "Failed to fetch profile");
    }
  };

    useEffect(() => {
    if (dToken) {
      getDoctorProfile();
    }
  }, [dToken]);

  const value = {
    backendUrl,
    dToken,
    setDToken,
    appointments,
    getAppointments,
    completeAppointment,
    cancelAppointment,
    markNoShow,
    scheduleFollowUp,
    rescheduleAppointment,
    rescheduleDay,
    cancelDay,
    dashData,
    getDashData,
    profileData,
    setProfileData,
    getProfileData,
    // Add leave management to context
    leaveRequests,
    requestLeave,
    getLeaveRequests,
    cancelLeaveRequest,
    doctorData,
  };
  
  return (
    <DoctorContext.Provider value={value}>
      {props.children}
    </DoctorContext.Provider>
  );
};

export default DoctorContextProvider;