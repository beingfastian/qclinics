// Every change to an appointment goes through this service: booking, follow-ups,
// completing, cancelling and moving (rescheduling). It keeps the slot reservation,
// status fields, history and notifications consistent no matter who made the change.
import appointmentModel from "../model/appointmentModel.js";
import doctorModel from "../model/doctorModel.js";
import userModel from "../model/userModel.js";
import {
  isValidSlotDate,
  normalizeSlotTime,
  slotToDate,
  reserveSlot,
  releaseSlot,
  HOSPITAL_UTC_OFFSET_MINUTES,
  hospitalIsoDate,
  dayTimes,
} from "../utils/slots.js";
import leaveRequestModel from "../model/leaveRequestModel.js";
import {
  sendWhatsAppConfirmation,
  sendDoctorWhatsAppConfirmation,
  sendWhatsAppCancellation,
  sendWhatsAppReschedule,
} from "../config/whatsappService.js";
import {
  sendUserAppointmentConfirmation,
  sendDoctorAppointmentNotification,
} from "../config/emailService.js";
import { queueNotification } from "./notificationQueue.js";
import { patientLanguage } from "../whatsapp/templates.js";
import { queueTokenModel } from "../model/queueModel.js";
import { shareForCompletion } from "./profitService.js";

// An error whose message is safe to show to staff
export class AppointmentError extends Error {
  // `code` lets screens react to a specific problem, e.g. "slot_taken"
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Appointments that can still change (also matches records from before `status` existed).
// Includes no-shows on purpose: a no-show can still be completed (patient came late),
// cancelled (marked by mistake) or rebooked to a new time.
const ACTIVE = { cancelled: { $ne: true }, isCompleted: { $ne: true } };
// Appointments the patient is still expected to come to (ACTIVE minus no-shows)
const EXPECTED = { ...ACTIVE, status: { $ne: "no_show" } };

// Same rules as admin/src/utils/slots.js: valid format, in the future, doctor available,
// on one of the doctor's sitting days and within their timings.
// Returns { slotDate, slotTime (normalized), startAt }.
export const validateSlot = (doctor, slotDate, slotTime, now = new Date()) => {
  const time = normalizeSlotTime(slotTime);
  if (!isValidSlotDate(slotDate) || !time) {
    throw new AppointmentError("Please select a date and time slot");
  }
  const startAt = slotToDate(slotDate, time);
  if (!startAt) throw new AppointmentError("Invalid date or time");
  if (startAt <= now) throw new AppointmentError("That time has already passed");
  if (!doctor.available) throw new AppointmentError("Doctor is not available for appointments");

  // Day and time in hospital time
  const local = new Date(startAt.getTime() + HOSPITAL_UTC_OFFSET_MINUTES * 60000);
  const day = DAY_NAMES[local.getUTCDay()];
  if (doctor.sittingDays?.length && !doctor.sittingDays.includes(day)) {
    throw new AppointmentError(`Dr. ${doctor.name} doesn't see patients on ${day[0].toUpperCase() + day.slice(1)}`);
  }
  if (doctor.timings?.start && doctor.timings?.end) {
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (minutes < toMinutes(doctor.timings.start) || minutes >= toMinutes(doctor.timings.end)) {
      throw new AppointmentError(
        `Dr. ${doctor.name} sees patients from ${doctor.timings.start} to ${doctor.timings.end}`
      );
    }
  }
  return { slotDate, slotTime: time, startAt };
};

// --- Leave ---

// Approved leave covering this moment (leave dates are whole days, hospital time)
export const findLeaveOn = (docId, startAt) => {
  const day = hospitalIsoDate(startAt);
  return leaveRequestModel.findOne({
    doctorId: docId,
    status: "approved",
    fromDate: { $lte: new Date(`${day}T00:00:00.000Z`) },
    toDate: { $gte: new Date(`${day}T00:00:00.000Z`) },
  });
};

const assertNotOnLeave = async (doctor, startAt) => {
  if (await findLeaveOn(doctor._id.toString(), startAt)) {
    throw new AppointmentError(`Dr. ${doctor.name} is on leave on that date`);
  }
};

// Active appointments of a doctor during a leave, grouped by day:
// [{ slotDate, count, appointments: [{ _id, slotTime, patient }] }]
export const getLeaveConflicts = async (leave) => {
  const from = new Date(new Date(leave.fromDate).getTime() - HOSPITAL_UTC_OFFSET_MINUTES * 60000);
  const to = new Date(new Date(leave.toDate).getTime() + 86400000 - HOSPITAL_UTC_OFFSET_MINUTES * 60000);
  const appointments = await appointmentModel
    .find({ docId: leave.doctorId, ...EXPECTED, startAt: { $gte: from, $lt: to } })
    .sort({ startAt: 1 })
    .select("slotDate slotTime userData.name");
  const byDay = new Map();
  for (const apt of appointments) {
    if (!byDay.has(apt.slotDate)) byDay.set(apt.slotDate, { slotDate: apt.slotDate, count: 0, appointments: [] });
    const day = byDay.get(apt.slotDate);
    day.count++;
    day.appointments.push({ _id: apt._id, slotTime: apt.slotTime, patient: apt.userData?.name });
  }
  return [...byDay.values()];
};

// Upcoming approved leave per doctor, for booking screens to hide those days:
// Map docId -> [{ from: "yyyy-mm-dd", to: "yyyy-mm-dd" }]
export const upcomingLeaves = async (docIds) => {
  const today = new Date(`${hospitalIsoDate(new Date())}T00:00:00.000Z`);
  const leaves = await leaveRequestModel
    .find({ doctorId: { $in: docIds }, status: "approved", toDate: { $gte: today } })
    .select("doctorId fromDate toDate");
  const byDoctor = new Map();
  for (const leave of leaves) {
    if (!byDoctor.has(leave.doctorId)) byDoctor.set(leave.doctorId, []);
    byDoctor.get(leave.doctorId).push({
      from: leave.fromDate.toISOString().slice(0, 10),
      to: leave.toDate.toISOString().slice(0, 10),
    });
  }
  return byDoctor;
};

const historyEntry = (action, actor, extra = {}) => ({ at: new Date(), by: actor, action, ...extra });

// Create an appointment: validate, reserve the slot atomically, save.
// actor: { role: "admin" | "doctor" | "patient" | "system", id }
export const bookAppointment = async ({
  patient,
  doctor,
  slotDate,
  slotTime,
  amount,
  discountPercent,
  finalFee,
  type = "new",
  parentAppointmentId,
  actor,
}) => {
  const slot = validateSlot(doctor, slotDate, slotTime);
  await assertNotOnLeave(doctor, slot.startAt);
  const docId = doctor._id.toString();

  if (!(await reserveSlot(docId, slot.slotDate, slot.slotTime))) {
    throw new AppointmentError("This time was just booked by someone else. Please choose another time.", "slot_taken");
  }

  const docSnapshot = doctor.toObject ? doctor.toObject() : { ...doctor };
  delete docSnapshot.slots_booked;
  delete docSnapshot.password;
  const userSnapshot = patient.toObject ? patient.toObject() : { ...patient };
  delete userSnapshot.password;

  try {
    return await appointmentModel.create({
      userId: patient._id.toString(),
      docId,
      slotDate: slot.slotDate,
      slotTime: slot.slotTime,
      startAt: slot.startAt,
      userData: userSnapshot,
      docData: docSnapshot,
      amount: amount ?? doctor.fee,
      date: Date.now(),
      status: "booked",
      type,
      ...(parentAppointmentId && { parentAppointmentId }),
      createdBy: actor,
      history: [
        historyEntry(type === "follow_up" ? "follow_up_booked" : "booked", actor, {
          to: { slotDate: slot.slotDate, slotTime: slot.slotTime },
        }),
      ],
      ...(discountPercent && { discountPercent }),
      ...(finalFee != null && { finalFee }),
    });
  } catch (error) {
    await releaseSlot(docId, slot.slotDate, slot.slotTime);
    throw error;
  }
};

// Queue WhatsApp + email confirmations; returns at once (they are sent in the background).
// Returns which messages were queued, e.g. { patient: ["whatsapp", "email"], doctor: ["email"] }.
export const queueBookingNotifications = (appointment, patient, doctor, { notifyDoctor = true } = {}) => {
  const { slotDate, slotTime, amount } = appointment;
  const appointmentId = appointment._id.toString();
  const patientPhone = patient.whatsappNumber || patient.phone;
  const queued = { patient: [], doctor: [] };
  const add = (recipient, channel, send) => {
    queueNotification({ appointmentId, channel, recipient, kind: "confirmation", send });
    queued[recipient].push(channel);
  };

  if (patient.whatsappEnabled && patientPhone) {
    add("patient", "whatsapp", () =>
      sendWhatsAppConfirmation(patientPhone, patient.name, doctor.name, doctor.speciality, slotDate, slotTime, amount, patientLanguage(patient)));
  }
  if (patient.email) {
    add("patient", "email", () =>
      sendUserAppointmentConfirmation(patient.email, patient.name, doctor.name, doctor.speciality, slotDate, slotTime, amount));
  }
  if (notifyDoctor && doctor.whatsappEnabled && doctor.whatsappNumber) {
    add("doctor", "whatsapp", () =>
      sendDoctorWhatsAppConfirmation(doctor.whatsappNumber, doctor.name, patient.name, patientPhone, slotDate, slotTime));
  }
  if (notifyDoctor && doctor.email) {
    add("doctor", "email", () =>
      sendDoctorAppointmentNotification(doctor.email, doctor.name, patient.name, patient.email || "Not provided", slotDate, slotTime, amount));
  }
  return queued;
};

// Mark as completed. Only an active appointment can be completed.
// The fee is split between hospital and doctor now, with the doctor's current share.
export const completeAppointment = async (appointmentId, actor) => {
  const appointment = await appointmentModel.findOne({ _id: appointmentId, ...ACTIVE }).select("docId amount").lean();
  if (!appointment) throw new AppointmentError("This appointment can't be completed (already completed or cancelled)");
  const share = await shareForCompletion(appointment);
  const updated = await appointmentModel.findOneAndUpdate(
    { _id: appointmentId, ...ACTIVE },
    {
      $set: { status: "completed", isCompleted: true, completedAt: new Date(), share },
      $push: { history: historyEntry("completed", actor) },
    },
    { new: true }
  );
  if (!updated) throw new AppointmentError("This appointment can't be completed (already completed or cancelled)");
  return updated;
};

// Mark as no-show: the patient never came. The slot is not released (its time
// has passed, so nobody can book it), and cancelled/isCompleted stay false, so
// existing screens keep working — the doctor can still Complete (patient showed
// up late) or Cancel (mistake) afterwards, which also acts as the undo.
// Ground reality: reception marks this after the slot time, so a future
// appointment is rejected to prevent clicking the wrong row.
export const markNoShow = async (appointmentId, actor) => {
  const appointment = await appointmentModel.findOne({
    _id: appointmentId,
    ...ACTIVE,
    status: { $ne: "no_show" },
  });
  if (!appointment) {
    throw new AppointmentError(
      "This appointment can't be marked as no-show (already completed, cancelled or marked)"
    );
  }
  const startAt = appointment.startAt || slotToDate(appointment.slotDate, appointment.slotTime);
  if (startAt && startAt > new Date()) {
    throw new AppointmentError("That appointment hasn't happened yet");
  }

  const updated = await appointmentModel.findOneAndUpdate(
    { _id: appointmentId, ...ACTIVE, status: { $ne: "no_show" } },
    {
      $set: { status: "no_show" },
      $push: { history: historyEntry("no_show", actor) },
    },
    { new: true }
  );
  if (!updated) {
    throw new AppointmentError("This appointment was changed by someone else. Please refresh and try again.");
  }
  return updated;
};

// Cancel, free the slot, and tell the patient (if they agreed to WhatsApp).
// cancelledBy: wording for the patient message, e.g. "the hospital" or "your doctor"
export const cancelAppointment = async (appointmentId, actor, { reason, cancelledBy, notifyPatient = true } = {}) => {
  const updated = await appointmentModel.findOneAndUpdate(
    { _id: appointmentId, ...ACTIVE },
    {
      $set: { status: "cancelled", cancelled: true },
      $push: { history: historyEntry("cancelled", actor, { ...(reason && { reason }) }) },
    },
    { new: true }
  );
  if (!updated) throw new AppointmentError("This appointment can't be cancelled (already completed or cancelled)");

  await releaseSlot(updated.docId, updated.slotDate, updated.slotTime);

  // If the patient was already checked in to the live queue, take them out of the line
  await queueTokenModel.updateMany(
    { appointmentId: updated._id.toString(), status: { $in: ["waiting", "skipped"] } },
    { $set: { status: "left" }, $push: { events: { at: new Date(), by: actor, action: "left" } } }
  );

  // No message for a visit whose time has already passed (e.g. undoing a no-show)
  const startAt = updated.startAt || slotToDate(updated.slotDate, updated.slotTime);
  const alreadyPast = startAt && startAt <= new Date();

  if (notifyPatient && !alreadyPast) {
    const patient = await userModel.findById(updated.userId).select("name whatsappEnabled whatsappNumber phone language");
    if (patient?.whatsappEnabled) {
      queueNotification({
        appointmentId: updated._id.toString(),
        channel: "whatsapp",
        recipient: "patient",
        kind: "cancellation",
        send: () =>
          sendWhatsAppCancellation(
            patient.whatsappNumber || patient.phone,
            patient.name,
            updated.docData?.name,
            updated.slotDate,
            updated.slotTime,
            cancelledBy || "the hospital",
            patientLanguage(patient)
          ),
      });
    }
  }
  return updated;
};

// Move an active appointment to a new time with the same doctor.
// Order: reserve the new slot -> update the appointment -> release the old slot,
// so a failure never leaves the patient without a slot. Reminders are reset.
// The patient is told on WhatsApp (old and new time) unless notifyPatient is false.
export const moveAppointment = async (appointmentId, newSlotDate, newSlotTime, actor, { reason, notifyPatient = true } = {}) => {
  const appointment = await appointmentModel.findOne({ _id: appointmentId, ...ACTIVE });
  if (!appointment) throw new AppointmentError("This appointment can't be moved (already completed or cancelled)");
  if (appointment.type === "walk_in") {
    throw new AppointmentError("A walk-in visit can't be moved. Book an appointment (or a follow-up) instead.");
  }

  const doctor = await doctorModel.findById(appointment.docId).select("-password");
  if (!doctor) throw new AppointmentError("Doctor not found");
  const slot = validateSlot(doctor, newSlotDate, newSlotTime);
  if (slot.slotDate === appointment.slotDate && slot.slotTime === appointment.slotTime) {
    throw new AppointmentError("The new time is the same as the current one");
  }
  await assertNotOnLeave(doctor, slot.startAt);

  if (!(await reserveSlot(appointment.docId, slot.slotDate, slot.slotTime))) {
    throw new AppointmentError("This time was just booked by someone else. Please choose another time.", "slot_taken");
  }

  const from = { slotDate: appointment.slotDate, slotTime: appointment.slotTime };
  const updated = await appointmentModel.findOneAndUpdate(
    { _id: appointmentId, ...ACTIVE, slotDate: from.slotDate, slotTime: from.slotTime },
    {
      // A rebooked no-show is expected again
      $set: { slotDate: slot.slotDate, slotTime: slot.slotTime, startAt: slot.startAt, status: "booked" },
      $unset: { reminders: 1 },
      $push: {
        history: historyEntry("rescheduled", actor, {
          from,
          to: { slotDate: slot.slotDate, slotTime: slot.slotTime },
          ...(reason && { reason }),
        }),
      },
    },
    { new: true }
  );
  if (!updated) {
    // Someone changed it meanwhile: give the new slot back
    await releaseSlot(appointment.docId, slot.slotDate, slot.slotTime);
    throw new AppointmentError("The appointment was changed by someone else. Please refresh and try again.");
  }

  await releaseSlot(appointment.docId, from.slotDate, from.slotTime);

  if (notifyPatient) {
    const patient = await userModel.findById(updated.userId).select("name whatsappEnabled whatsappNumber phone language");
    if (patient?.whatsappEnabled) {
      queueNotification({
        appointmentId: updated._id.toString(),
        channel: "whatsapp",
        recipient: "patient",
        kind: "reschedule",
        send: () =>
          sendWhatsAppReschedule(
            patient.whatsappNumber || patient.phone,
            patient.name,
            updated.docData?.name,
            from.slotDate,
            from.slotTime,
            updated.slotDate,
            updated.slotTime,
            patientLanguage(patient)
          ),
      });
    }
  }
  return updated;
};

// --- Whole-day actions (doctor away, emergency, approved leave) ---

// No-shows are left alone: moving or cancelling them would message patients
// about a visit they already missed and erase the no-show from the counts
// Walk-in visits are handled in the live queue (they have no booked time to move)
const activeOnDay = (docId, slotDate) =>
  appointmentModel.find({ docId, slotDate, ...EXPECTED, type: { $ne: "walk_in" } }).sort({ startAt: 1 });

// Move every active appointment of a doctor from one day to another.
// Each keeps its time if free, otherwise gets the nearest free time on the new day
// (later first, then earlier). Returns { moved: [...], notMoved: [...] }.
export const rescheduleDay = async ({ docId, fromSlotDate, toSlotDate, actor, reason }) => {
  if (!isValidSlotDate(fromSlotDate) || !isValidSlotDate(toSlotDate)) {
    throw new AppointmentError("Please choose both dates");
  }
  if (fromSlotDate === toSlotDate) throw new AppointmentError("Choose a different date to move to");
  const doctor = await doctorModel.findById(docId).select("-password");
  if (!doctor) throw new AppointmentError("Doctor not found");

  const times = dayTimes(doctor);
  const moved = [];
  const pending = [];
  const failures = new Map();

  // Try one time; returns true if moved. "Taken" is recorded so the next time can be tried;
  // anything else (leave, not a sitting day, past) applies to the whole day.
  const tryMove = async (apt, time) => {
    try {
      const updated = await moveAppointment(apt._id, toSlotDate, time, actor, { reason });
      moved.push({ _id: apt._id, patient: apt.userData?.name, from: apt.slotTime, to: updated.slotTime });
      return true;
    } catch (error) {
      if (!(error instanceof AppointmentError)) throw error;
      failures.set(apt._id.toString(), error.message);
      return false;
    }
  };
  const isTaken = (apt) => failures.get(apt._id.toString()) === "Selected time slot is not available";

  // Pass 1: everyone whose same time is free keeps it
  for (const apt of await activeOnDay(docId, fromSlotDate)) {
    if (!(await tryMove(apt, apt.slotTime))) pending.push(apt);
  }

  // Pass 2: the rest get the nearest free time (later first, then earlier)
  const notMoved = [];
  for (const apt of pending) {
    let done = false;
    if (isTaken(apt)) {
      const index = times.indexOf(apt.slotTime);
      const later = index >= 0 ? times.slice(index + 1) : times;
      const earlier = index > 0 ? times.slice(0, index).reverse() : [];
      for (const time of [...later, ...earlier]) {
        if (await tryMove(apt, time)) { done = true; break; }
        if (!isTaken(apt)) break;
      }
    }
    if (!done) {
      const why = failures.get(apt._id.toString());
      notMoved.push({
        _id: apt._id,
        patient: apt.userData?.name,
        time: apt.slotTime,
        reason: why === "Selected time slot is not available" ? "No free time left on the new day" : why,
      });
    }
  }
  return { moved, notMoved };
};

// Cancel every active appointment of a doctor on one day (patients are told on WhatsApp).
export const cancelDay = async ({ docId, slotDate, actor, reason, cancelledBy }) => {
  if (!isValidSlotDate(slotDate)) throw new AppointmentError("Please choose a date");
  const cancelled = [];
  for (const apt of await activeOnDay(docId, slotDate)) {
    try {
      await cancelAppointment(apt._id, actor, { reason, cancelledBy });
      cancelled.push({ _id: apt._id, patient: apt.userData?.name, time: apt.slotTime });
    } catch (error) {
      if (!(error instanceof AppointmentError)) throw error;
    }
  }
  return { cancelled };
};

// Follow-up visits are free within this many days of the original visit (0 = always charge)
const followUpFreeDays = () => Number(process.env.FOLLOW_UP_FREE_DAYS ?? 0);

// A doctor schedules a follow-up from one of their own appointments.
export const bookFollowUp = async ({ parentAppointmentId, doctorId, slotDate, slotTime }) => {
  const parent = await appointmentModel.findById(parentAppointmentId);
  if (!parent || parent.docId !== doctorId) throw new AppointmentError("Appointment not found");
  if (parent.cancelled) throw new AppointmentError("Can't schedule a follow-up for a cancelled appointment");

  const [patient, doctor] = await Promise.all([
    userModel.findById(parent.userId).select("-password"),
    doctorModel.findById(doctorId).select("-password"),
  ]);
  if (!patient) throw new AppointmentError("Patient no longer exists");
  if (!doctor) throw new AppointmentError("Doctor not found");

  // Free if within the follow-up window of the original visit. A visit the patient
  // missed (no-show) doesn't earn a free follow-up.
  const freeDays = followUpFreeDays();
  const parentStart = parent.startAt || slotToDate(parent.slotDate, parent.slotTime);
  const newStart = slotToDate(slotDate, normalizeSlotTime(slotTime) || "");
  const isFree =
    parent.status !== "no_show" &&
    freeDays > 0 && parentStart && newStart && newStart - parentStart <= freeDays * 86400000;

  return bookAppointment({
    patient,
    doctor,
    slotDate,
    slotTime,
    amount: isFree ? 0 : doctor.fee,
    type: "follow_up",
    parentAppointmentId: parent._id.toString(),
    actor: { role: "doctor", id: doctorId },
  }).then((appointment) => ({ appointment, patient, doctor }));
};
