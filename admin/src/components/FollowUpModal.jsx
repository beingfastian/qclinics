import { useContext, useEffect, useState } from "react";
import { DoctorContext } from "../context/DoctorContext";
import { AppContext } from "../context/AppContext";
import SlotPickerDialog from "./SlotPickerDialog";
import PrintSlipDialog from "./PrintSlip";

// Doctor picks a date and time for a patient's follow-up visit.
// After it is saved, offers a printable slip — the rural patient often has no
// smartphone, so the date/time in their hand is what gets them back on time.
const FollowUpModal = ({ appointment, onClose }) => {
  const { profileData, getProfileData, scheduleFollowUp } = useContext(DoctorContext);
  const { slotDateFormat } = useContext(AppContext);
  const [loaded, setLoaded] = useState(false);
  // Set after a successful save: the details to print
  const [slip, setSlip] = useState(null);

  // Fresh profile so booked slots and leave are current
  useEffect(() => {
    getProfileData().finally(() => setLoaded(true));
  }, []);

  const handleConfirm = async (slotDate, slotTime) => {
    const saved = await scheduleFollowUp(appointment._id, slotDate, slotTime);
    if (saved) {
      setSlip({
        patientName: appointment.userData?.name,
        doctorName: saved.docData?.name || profileData?.name,
        speciality: saved.docData?.speciality || profileData?.speciality,
        dateText: slotDateFormat(saved.slotDate || slotDate),
        time: saved.slotTime || slotTime,
        // `saved` is the appointment from the API; amount 0 = free follow-up.
        // If it is somehow missing, the slip shows "See at counter", not "Free".
        fee: typeof saved.amount === "number" ? saved.amount : undefined,
      });
    }
    // Returning false keeps the picker open on failure (toast already shown);
    // on success the slip dialog replaces it below.
    return false;
  };

  if (slip) {
    return <PrintSlipDialog title="Follow-up scheduled" details={slip} onClose={onClose} />;
  }

  return (
    <SlotPickerDialog
      title="Schedule Follow-up"
      subtitle={`Patient: ${appointment.userData?.name}`}
      doctor={loaded ? profileData : null}
      confirmVerb="Schedule for"
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
};

export default FollowUpModal;
