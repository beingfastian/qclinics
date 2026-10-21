import { useContext, useEffect, useState } from "react";
import { AdminContext } from "../context/AdminContext";
import { DoctorContext } from "../context/DoctorContext";
import { AppContext } from "../context/AppContext";
import SlotPickerDialog from "./SlotPickerDialog";

const useSubtitle = (appointment) => {
  const { slotDateFormat } = useContext(AppContext);
  return `${appointment.userData?.name}: currently ${slotDateFormat(appointment.slotDate)}, ${appointment.slotTime}`;
};

// Doctor moves one of their own appointments
export const DoctorRescheduleModal = ({ appointment, onClose }) => {
  const { profileData, getProfileData, rescheduleAppointment } = useContext(DoctorContext);
  const [loaded, setLoaded] = useState(false);
  const subtitle = useSubtitle(appointment);

  // Fresh profile so booked slots and leave are current
  useEffect(() => {
    getProfileData().finally(() => setLoaded(true));
  }, []);

  return (
    <SlotPickerDialog
      title="Reschedule Appointment"
      subtitle={subtitle}
      doctor={loaded ? profileData : null}
      confirmVerb="Move to"
      showReason
      onConfirm={(slotDate, slotTime, reason) => rescheduleAppointment(appointment._id, slotDate, slotTime, reason)}
      onClose={onClose}
    />
  );
};

// Admin moves any appointment (same doctor, new date/time)
export const AdminRescheduleModal = ({ appointment, onClose }) => {
  const { doctors, getAllDoctors, rescheduleAppointment } = useContext(AdminContext);
  const [loaded, setLoaded] = useState(false);
  const subtitle = useSubtitle(appointment);

  // Fresh doctor list so booked slots and leave are current
  useEffect(() => {
    getAllDoctors().finally(() => setLoaded(true));
  }, []);

  const doctor = loaded ? doctors.find((d) => d._id === appointment.docId) : null;

  return (
    <SlotPickerDialog
      title={`Reschedule with Dr. ${appointment.docData?.name || ""}`}
      subtitle={subtitle}
      doctor={doctor}
      confirmVerb="Move to"
      showReason
      onConfirm={(slotDate, slotTime, reason) => rescheduleAppointment(appointment._id, slotDate, slotTime, reason)}
      onClose={onClose}
    />
  );
};
