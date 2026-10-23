// The patient a doctor is acting for (lab request, prescription): from one of the
// doctor's appointments, a queue token (walk-ins may have no patient record), or a
// patient record. fail(message) makes the caller's own error, whose message staff see.
import appointmentModel from "../model/appointmentModel.js";
import userModel from "../model/userModel.js";
import { queueTokenModel } from "../model/queueModel.js";

export const resolveVisitPatient = async ({ docId, appointmentId, queueTokenId, userId }, fail) => {
  if (appointmentId) {
    const appointment = await appointmentModel.findById(appointmentId).lean();
    if (!appointment || appointment.docId !== docId) throw fail("Appointment not found");
    if (appointment.cancelled) throw fail("This appointment was cancelled");
    return { userId: appointment.userId, appointmentId: String(appointment._id) };
  }
  if (queueTokenId) {
    const token = await queueTokenModel.findById(queueTokenId).lean();
    if (!token || token.docId !== docId) throw fail("Queue token not found");
    return {
      userId: token.userId,
      appointmentId: token.appointmentId,
      queueTokenId: String(token._id),
      walkIn: { name: token.patientName, phone: token.phone, age: token.age, gender: token.gender },
    };
  }
  if (userId) return { userId: String(userId) };
  throw fail("Please choose the patient");
};

// The patient record (if any) and a snapshot to keep with the lab request or
// prescription: what the patient was called and how to reach them at the time
export const visitPatientSnapshot = async (source, fail) => {
  const user = source.userId ? await userModel.findById(source.userId).select("name phone gender dob").lean() : null;
  if (!user && !source.walkIn) throw fail("Patient not found");
  const patient = user
    ? { name: user.name, phone: user.phone, gender: user.gender || source.walkIn?.gender, dob: user.dob, ...(source.walkIn?.age && { age: source.walkIn.age }) }
    : { name: source.walkIn.name, phone: source.walkIn.phone, age: source.walkIn.age, gender: source.walkIn.gender };
  return { user, patient };
};
