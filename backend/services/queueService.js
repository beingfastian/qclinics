// Live OPD queue: tokens for walk-ins and arrived appointment patients, the order
// they are seen in, wait estimates, and WhatsApp updates.
//
// Ground rules (how OPDs in Pakistan actually run):
// - Most patients walk in. Reception gives a token number; the doctor calls the next one.
// - Appointment patients get a token when they arrive (check-in). They are placed in
//   line at their booked time, or at their arrival time if they came late.
// - Urgent patients (emergency, elderly, disabled) go ahead of the regular line.
// - A called patient who isn't there (went for tea, to the lab) is "skipped" and can
//   be put back at the front of the line when they return.
// - The doctor may take a break (prayer, rounds, emergency); the waiting room sees it.
// - Many patients have no smartphone. The printed token slip is the main channel;
//   WhatsApp (to them or a family member's number) is an extra, with consent only.
//
// Settings (backend .env):
//   QUEUE_DEFAULT_MINUTES=10  minutes per patient used for estimates until real
//                             consultations today give a better average
//   QUEUE_NOTIFY_AHEAD=3      send "your turn is near" when this many are ahead; 0 = off
//   QUEUE_WHATSAPP=false      turns all queue WhatsApp messages off (they cost money)
//   PUBLIC_SITE_URL           patient website, for the "see your turn live" link
import crypto from "crypto";
import { queueTokenModel, queueDayModel } from "../model/queueModel.js";
import appointmentModel from "../model/appointmentModel.js";
import doctorModel from "../model/doctorModel.js";
import mongoose from "mongoose";
import userModel from "../model/userModel.js";
import { hospitalSlotDate, slotToDate, HOSPITAL_UTC_OFFSET_MINUTES } from "../utils/slots.js";
import { normalizePhone, phoneVariants } from "../whatsapp/phone.js";
import { LANGUAGES, patientLanguage } from "../whatsapp/templates.js";
import { sendWhatsAppQueueToken, sendWhatsAppTurnNear } from "../config/whatsappService.js";
import { queueNotification } from "./notificationQueue.js";
import { completeAppointment, cancelAppointment, AppointmentError } from "./appointmentService.js";
import { background } from "../utils/background.js";

// An error whose message is safe to show to staff
export class QueueError extends Error {}

const defaultMinutes = () => Math.max(1, Number(process.env.QUEUE_DEFAULT_MINUTES) || 10);
const notifyAhead = () => Math.max(0, Number(process.env.QUEUE_NOTIFY_AHEAD ?? 3) || 0);
const queueWhatsAppOn = () => process.env.QUEUE_WHATSAPP !== "false";
const publicSiteUrl = () => (process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

// Public "see your turn" page for a token (null when PUBLIC_SITE_URL isn't set)
export const trackUrl = (publicId) => (publicSiteUrl() ? `${publicSiteUrl()}/queue/t/${publicId}` : null);

// Today in hospital time, "d_m_yyyy"
export const today = () => hospitalSlotDate(new Date());

const dayKey = (docId, day) => `${docId}_${day}`;

// Line order: urgent first, then by place in line, then token number
const WAITING_SORT = { urgent: -1, sortAt: 1, number: 1 };
const compareWaiting = (a, b) =>
  Number(b.urgent) - Number(a.urgent) || new Date(a.sortAt) - new Date(b.sortAt) || a.number - b.number;

const event = (action, actor) => ({ at: new Date(), by: actor, action });

// Next token number for a doctor's day (atomic, so two receptionists never get the same one)
const nextNumber = async (docId, day) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await queueDayModel.findOneAndUpdate(
        { _id: dayKey(docId, day) },
        { $inc: { lastNumber: 1 }, $setOnInsert: { docId, day } },
        { upsert: true, new: true }
      );
      return counter.lastNumber;
    } catch (error) {
      // Two first tokens of the day at the same moment: the second upsert retries
      if (error.code !== 11000 || attempt >= 2) throw error;
    }
  }
};

// Average minutes per patient today, from the last few finished consultations.
// Blended with the default until there are 3, so one quick visit doesn't promise
// everyone a 1-minute wait.
export const averageMinutes = async (docId, day) => {
  const finished = await queueTokenModel
    .find({ docId, day, status: "done", calledAt: { $exists: true }, doneAt: { $exists: true } })
    .sort({ doneAt: -1 })
    .limit(10)
    .select("calledAt doneAt")
    .lean();
  const fallback = defaultMinutes();
  const samples = finished
    .map((t) => (new Date(t.doneAt) - new Date(t.calledAt)) / 60000)
    .filter((minutes) => minutes >= 0.5 && minutes <= 60);
  if (!samples.length) return fallback;
  const mean = samples.reduce((sum, m) => sum + m, 0) / samples.length;
  const weight = Math.min(samples.length, 3);
  return Math.max(1, Math.round((mean * weight + fallback * (3 - weight)) / 3));
};

// Rough wait, rounded to 5 minutes: honest about being approximate
const roundWait = (minutes) => Math.max(0, Math.round(minutes / 5) * 5);

// Everything screens need about one doctor's queue on a day
export const queueSnapshot = async (docId, day = today()) => {
  const [tokens, dayDoc, avgMinutes] = await Promise.all([
    queueTokenModel.find({ docId, day }).sort({ number: 1 }).lean(),
    queueDayModel.findById(dayKey(docId, day)).lean(),
    averageMinutes(docId, day),
  ]);
  const waiting = tokens.filter((t) => t.status === "waiting").sort(compareWaiting);
  const current = tokens.filter((t) => t.status === "called").sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))[0] || null;
  return {
    day,
    tokens,
    waiting,
    current,
    avgMinutes,
    paused: Boolean(dayDoc?.paused),
    pauseNote: dayDoc?.pauseNote || "",
    // Has the doctor called anyone yet today? (Before that, estimates are only a guess.)
    started: tokens.some((t) => t.calledAt),
  };
};

// Place in line and estimated wait for one waiting token
export const estimateFor = (snapshot, tokenId) => {
  const index = snapshot.waiting.findIndex((t) => String(t._id) === String(tokenId));
  if (index < 0) return null;
  const withDoctor = snapshot.current ? snapshot.avgMinutes / 2 : 0;
  return { ahead: index, waitMinutes: roundWait(index * snapshot.avgMinutes + withDoctor) };
};

// WhatsApp to a token's patient in the background; the outcome is logged on the token
const sendQueueMessage = (token, kind, send) =>
  queueNotification({
    appointmentId: token.appointmentId,
    channel: "whatsapp",
    recipient: "patient",
    kind,
    send,
    onDone: (status, error) =>
      queueTokenModel.updateOne(
        { _id: token._id },
        { $push: { messages: { at: new Date(), kind, status, ...(error && { error: String(error).slice(0, 300) }) } } }
      ),
  });

const doctorName = async (docId) => (await doctorModel.findById(docId).select("name").lean())?.name || "";

// "Your turn is near" to everyone within QUEUE_NOTIFY_AHEAD of the front who hasn't had it
const notifyTurnNear = async (docId, day) => {
  const limit = notifyAhead();
  if (!limit || !queueWhatsAppOn()) return;
  const front = await queueTokenModel.find({ docId, day, status: "waiting" }).sort(WAITING_SORT).limit(limit + 1);
  let name;
  for (const [ahead, token] of front.entries()) {
    if (!token.notify || !token.phone || token.nearNotifiedAt) continue;
    // Claim first, so two quick "call next" clicks don't send it twice
    const claimed = await queueTokenModel.updateOne(
      { _id: token._id, nearNotifiedAt: { $exists: false } },
      { $set: { nearNotifiedAt: new Date() } }
    );
    if (!claimed.modifiedCount) continue;
    name ??= await doctorName(docId);
    sendQueueMessage(token, "queue_turn_near", () =>
      sendWhatsAppTurnNear(token.phone, token.patientName, name, token.number, ahead, token.language)
    );
  }
};
// Runs after the reply; on Vercel, waitUntil keeps the function alive for it
const notifyTurnNearSafely = (docId, day) =>
  background(notifyTurnNear(docId, day).catch((error) => console.error("Queue turn-near check failed:", error.message)));

// "hh:mm AM" of a moment, in hospital time (how appointment times are stored)
const slotTimeOf = (moment) => {
  const local = new Date(moment.getTime() + HOSPITAL_UTC_OFFSET_MINUTES * 60000);
  const h24 = local.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

// Approximate date of birth ("yyyy-mm-dd") from an age told at reception: "45", "45 y", "6 months", "10 days"
const dobFromAge = (ageText, now) => {
  const match = /^(\d{1,3})\s*([a-z]*)/i.exec(ageText);
  const value = Number(match?.[1] || 0);
  const unit = (match?.[2] || "y").toLowerCase();
  const date = new Date(now);
  if (unit.startsWith("d")) date.setDate(date.getDate() - value);
  else if (unit.startsWith("m")) date.setMonth(date.getMonth() - value);
  else date.setFullYear(date.getFullYear() - value);
  return date.toISOString().slice(0, 10);
};

// "45 y" from a date of birth
const ageLabel = (dob, now) => {
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return undefined;
  let years = now.getFullYear() - born.getFullYear();
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) years--;
  return years >= 0 && years < 130 ? `${years} y` : undefined;
};

// The visit record for a walk-in: like an appointment booked for right now. It
// doesn't reserve a booking slot (the patient is already here, in the queue).
const createWalkInVisit = ({ user, doctor, day, now, fee, actor }) => {
  const userData = user.toObject ? user.toObject() : { ...user };
  delete userData.password;
  return appointmentModel.create({
    userId: String(user._id),
    docId: String(doctor._id),
    slotDate: day,
    slotTime: slotTimeOf(now),
    startAt: now,
    userData,
    docData: doctor,
    amount: fee,
    finalFee: fee,
    date: now.getTime(),
    status: "booked",
    type: "walk_in",
    createdBy: actor,
    history: [
      { at: now, by: actor, action: "booked", to: { slotDate: day, slotTime: slotTimeOf(now) } },
      { at: now, by: actor, action: "checked_in" },
    ],
  });
};

// Pakistani mobile numbers (WhatsApp needs a mobile), or any international number
const isMobileNumber = (e164) => /^\+923\d{9}$/.test(e164) || (/^\+\d{10,15}$/.test(e164) && !e164.startsWith("+92"));

// Give a token to a walk-in, or check in an appointment patient who has arrived.
// Returns { token, existing } (existing: this appointment was already checked in today).
export const issueToken = async ({ docId, appointmentId, userId, patientName, phone, cnic, notify, language, fee, urgent, age, gender, actor }) => {
  const doctor = await doctorModel.findById(docId).select("-password -slots_booked").lean();
  if (!doctor) throw new QueueError("Doctor not found");
  docId = String(docId);
  const day = today();
  const now = new Date();
  let details;

  if (appointmentId) {
    const appointment = await appointmentModel.findById(appointmentId);
    if (!appointment || appointment.docId !== docId) throw new QueueError("Appointment not found");
    if (appointment.cancelled) throw new QueueError("This appointment was cancelled");
    if (appointment.isCompleted) throw new QueueError("This appointment is already completed");
    if (appointment.slotDate !== day) throw new QueueError("This appointment is not for today");

    // Checked in twice (double click, second receptionist): hand back the same token
    const existing = await queueTokenModel.findOne({ appointmentId: String(appointment._id), day });
    if (existing) return { token: existing, existing: true };

    const user = await userModel.findById(appointment.userId).select("name phone whatsappNumber whatsappEnabled language").lean();
    const startAt = appointment.startAt || slotToDate(appointment.slotDate, appointment.slotTime);
    details = {
      kind: "appointment",
      appointmentId: String(appointment._id),
      userId: appointment.userId,
      patientName: user?.name || appointment.userData?.name || "Patient",
      phone: normalizePhone(user ? user.whatsappNumber || user.phone : appointment.userData?.phone) || undefined,
      notify: Boolean(user?.whatsappEnabled),
      language: patientLanguage(user || appointment.userData),
      fee: appointment.amount,
      sortAt: startAt && startAt > now ? startAt : now,
    };

  } else {
    // A walk-in: every patient seen is a real patient record and a real visit, so the
    // doctor can complete it (earnings), book a follow-up, request lab tests, and the
    // visit is in the patient's history.
    const ageText = String(age ?? "").trim().slice(0, 20);
    if (ageText && !/^\d{1,3}(\s*(y|yr|yrs|years?|m|mo|months?|d|days?))?$/i.test(ageText)) {
      throw new QueueError("Please enter the age as a number, e.g. 45 (or 6 months)");
    }
    const genderValue = ["Male", "Female", "Other"].includes(gender) ? gender : undefined;
    const feeValue = fee === undefined || fee === null || fee === "" ? Number(doctor.fee) || 0 : Number(fee);
    if (!Number.isFinite(feeValue) || feeValue < 0) throw new QueueError("Please enter a valid fee");

    let user;
    if (userId) {
      user = await userModel.findById(userId);
      if (!user) throw new QueueError("Patient not found. Please search again.");
      // Fill in what reception just learned, if the record didn't have it
      const fill = {};
      if (ageText && !user.dob) Object.assign(fill, { dob: dobFromAge(ageText, now), dobEstimated: true });
      if (genderValue && !user.gender) fill.gender = genderValue;
      if (Object.keys(fill).length) user = await userModel.findByIdAndUpdate(user._id, fill, { new: true });
    } else {
      const name = String(patientName || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (!name) throw new QueueError("Please enter the patient's name");
      const e164 = String(phone || "").trim() ? normalizePhone(phone) : null;
      if (e164 && !/^\+\d{10,15}$/.test(e164)) throw new QueueError("Please enter a valid phone number");
      // Stored the way receptions write numbers: 03xx xxxxxxx -> 03xxxxxxxxx
      const phoneText = e164 ? (e164.startsWith("+92") ? "0" + e164.slice(3) : e164) : "";
      const cnicText = String(cnic || "").replace(/\D/g, "");
      if (cnicText && cnicText.length !== 13) throw new QueueError("CNIC must be 13 digits");
      if (cnicText) {
        const existing = await userModel.findOne({ cnic: cnicText }).select("name").lean();
        if (existing) throw new QueueError(`This CNIC is already registered to ${existing.name}. Search for the patient and select them.`);
      }
      user = await userModel.create({
        name,
        ...(phoneText && { phone: phoneText, whatsappNumber: phoneText }),
        ...(cnicText && { cnic: cnicText }),
        gender: genderValue || "",
        ...(ageText && { dob: dobFromAge(ageText, now), dobEstimated: true }),
        ...(LANGUAGES.includes(language) && { language }),
      });
    }

    // WhatsApp updates: only to a mobile number, and only with consent (recorded on the patient)
    const contact = normalizePhone(user.whatsappNumber || user.phone);
    const wantsWhatsApp = Boolean(notify && contact);
    if (notify && !contact) throw new QueueError("Enter a phone number for WhatsApp updates, or turn them off");
    if (wantsWhatsApp && !isMobileNumber(contact)) {
      throw new QueueError("WhatsApp updates need a mobile number (03xx xxxxxxx)");
    }
    if (wantsWhatsApp && !user.whatsappEnabled) {
      user = await userModel.findByIdAndUpdate(
        user._id,
        {
          whatsappEnabled: true,
          whatsappConsentAt: now,
          ...(!user.whatsappNumber && { whatsappNumber: user.phone }),
          ...(LANGUAGES.includes(language) && { language }),
        },
        { new: true }
      );
    }

    const visit = await createWalkInVisit({ user, doctor, day, now, fee: Math.round(feeValue), actor });
    details = {
      kind: "walk_in",
      appointmentId: String(visit._id),
      userId: String(user._id),
      patientName: user.name,
      ...(contact && { phone: contact }),
      ...(ageText ? { age: /^\d+$/.test(ageText) ? `${ageText} y` : ageText } : user.dob && { age: ageLabel(user.dob, now) }),
      ...((genderValue || user.gender) && ["Male", "Female", "Other"].includes(genderValue || user.gender) && { gender: genderValue || user.gender }),
      notify: wantsWhatsApp,
      language: LANGUAGES.includes(language) ? language : patientLanguage(user),
      fee: Math.round(feeValue),
      sortAt: now,
    };
  }

  const number = await nextNumber(docId, day);
  let token;
  try {
  for (let attempt = 0; ; attempt++) {
    try {
      token = await queueTokenModel.create({
        docId,
        day,
        number,
        ...details,
        urgent: Boolean(urgent),
        publicId: crypto.randomBytes(6).toString("base64url"),
        events: [event("issued", actor)],
      });
      break;
    } catch (error) {
      if (error.code === 11000 && details.appointmentId && /appointmentId/.test(error.message)) {
        // Same appointment checked in at the same moment elsewhere: hand back that token
        const existing = await queueTokenModel.findOne({ appointmentId: details.appointmentId, day });
        if (existing) return { token: existing, existing: true };
      }
      // publicId collision is practically impossible; retry once with a new one
      if (error.code !== 11000 || attempt >= 1 || !/publicId/.test(error.message)) throw error;
    }
  }
  } catch (error) {
    // No token, so no visit either (the patient record stays: they did come)
    if (details.kind === "walk_in") await appointmentModel.deleteOne({ _id: details.appointmentId }).catch(() => {});
    throw error;
  }

  if (details.kind === "appointment") {
    // Record the arrival; a no-show mark (e.g. made while they were stuck in traffic) is undone
    await appointmentModel.updateOne(
      { _id: details.appointmentId },
      { $push: { history: { at: now, by: actor, action: "checked_in" } } }
    );
    await appointmentModel.updateOne({ _id: details.appointmentId, status: "no_show" }, { $set: { status: "booked" } });
  }

  if (token.notify && token.phone && queueWhatsAppOn()) {
    const snapshot = await queueSnapshot(docId, day);
    const estimate = estimateFor(snapshot, token._id) || { ahead: 0, waitMinutes: 0 };
    const url = trackUrl(token.publicId);
    if (url) {
      sendQueueMessage(token, "queue_token", () =>
        sendWhatsAppQueueToken(token.phone, token.patientName, token.number, doctor.name, estimate.ahead, estimate.waitMinutes, url, token.language)
      );
    }
    // The token message already says how many are ahead; don't follow it at once with
    // "your turn is near". (Without a link there is no token message, so they get that one.)
    if (url && estimate.ahead <= notifyAhead()) {
      await queueTokenModel.updateOne({ _id: token._id }, { $set: { nearNotifiedAt: new Date() } });
    }
  }
  return { token, existing: false };
};

// Finish a consultation. An appointment token also completes the appointment.
const markDone = async (token, actor) => {
  const updated = await queueTokenModel.findOneAndUpdate(
    { _id: token._id, status: "called" },
    { $set: { status: "done", doneAt: new Date() }, $push: { events: event("done", actor) } },
    { new: true }
  );
  if (updated?.appointmentId) {
    try {
      await completeAppointment(updated.appointmentId, actor);
    } catch (error) {
      // Already completed from the appointments page: nothing to do
      if (!(error instanceof AppointmentError)) throw error;
    }
  }
  return updated;
};

const findToken = async (docId, tokenId) => {
  const token = await queueTokenModel.findById(tokenId);
  if (!token || token.docId !== String(docId)) throw new QueueError("Token not found");
  return token;
};

// One "call next" at a time per doctor (doctor and reception may press it together).
// The lock expires by itself in case a request dies halfway.
const CALL_LOCK_MS = 15000;
const withCallLock = async (docId, day, work) => {
  const now = new Date();
  let locked = null;
  try {
    locked = await queueDayModel.findOneAndUpdate(
      { _id: dayKey(docId, day), $or: [{ callLockUntil: { $exists: false } }, { callLockUntil: { $lt: now } }] },
      { $set: { callLockUntil: new Date(now.getTime() + CALL_LOCK_MS) }, $setOnInsert: { docId, day } },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error; // the day exists and is locked
  }
  if (!locked) throw new QueueError("Someone else is calling a patient right now. Please wait a moment.");
  try {
    return await work();
  } finally {
    await queueDayModel.updateOne({ _id: dayKey(docId, day) }, { $unset: { callLockUntil: 1 } });
  }
};

// Finish whoever is with the doctor and call the next in line (or a chosen token).
// expectedCurrentId: the token the caller's screen shows with the doctor ("" = nobody).
// If someone else changed that meanwhile, nothing happens and the screen refreshes,
// so an out-of-date screen never finishes a patient it didn't show.
// Returns the called token, or null when nobody is waiting.
export const callNext = async (docId, actor, tokenId, expectedCurrentId) => {
  docId = String(docId);
  const day = today();
  return withCallLock(docId, day, async () => {
    const currents = await queueTokenModel.find({ docId, day, status: "called" });
    if (expectedCurrentId !== undefined && expectedCurrentId !== null) {
      const shown = String(expectedCurrentId);
      const actual = currents.map((t) => String(t._id));
      if ((shown && !actual.includes(shown)) || (!shown && actual.length)) {
        throw new QueueError("The queue just changed on another screen. It has been refreshed; please check and try again.");
      }
    }

    // Pick who comes next before finishing anyone, so a failed call changes nothing
    let next;
    if (tokenId) {
      next = await queueTokenModel.findOne({ _id: tokenId, docId, day, status: { $in: ["waiting", "skipped"] } });
      if (!next) throw new QueueError("That token can't be called now (already seen or removed)");
    } else {
      next = await queueTokenModel.findOne({ docId, day, status: "waiting" }).sort(WAITING_SORT);
    }

    for (const current of currents) await markDone(current, actor);

    let called = null;
    if (next) {
      called = await queueTokenModel.findOneAndUpdate(
        { _id: next._id, status: { $in: ["waiting", "skipped"] } },
        { $set: { status: "called", calledAt: new Date() }, $push: { events: event("called", actor) } },
        { new: true }
      );
    }
    notifyTurnNearSafely(docId, day);
    return called;
  });
};

// Other changes to one token:
//   done          finish the consultation without calling anyone (e.g. last patient)
//   skip          called (or waiting) but not here
//   back_in_line  a skipped patient returned: put them at the front of the regular line
//   left          went home / token cancelled
//   urgent        toggle urgent (seen before the regular line)
export const tokenAction = async (docId, tokenId, action, actor) => {
  const token = await findToken(docId, tokenId);
  const day = token.day;
  let result;

  switch (action) {
    case "done":
      if (token.status !== "called") throw new QueueError("Only the patient with the doctor can be marked done");
      result = await markDone(token, actor);
      break;

    case "skip":
      result = await queueTokenModel.findOneAndUpdate(
        { _id: token._id, status: { $in: ["called", "waiting"] } },
        { $set: { status: "skipped" }, $push: { events: event("skipped", actor) } },
        { new: true }
      );
      break;

    case "back_in_line": {
      // Just ahead of the first regular (non-urgent) patient waiting
      const first = await queueTokenModel
        .findOne({ docId: token.docId, day, status: "waiting", urgent: false })
        .sort({ sortAt: 1, number: 1 })
        .select("sortAt")
        .lean();
      const sortAt = first ? new Date(new Date(first.sortAt).getTime() - 1000) : new Date();
      result = await queueTokenModel.findOneAndUpdate(
        { _id: token._id, status: "skipped" },
        { $set: { status: "waiting", sortAt }, $push: { events: event("back_in_line", actor) } },
        { new: true }
      );
      break;
    }

    case "left":
      result = await queueTokenModel.findOneAndUpdate(
        { _id: token._id, status: { $in: ["waiting", "skipped", "called"] } },
        { $set: { status: "left" }, $push: { events: event("left", actor) } },
        { new: true }
      );
      // A walk-in who went home without being seen: their visit is cancelled (no message).
      // An appointment patient's booking is left as it is (reception may mark a no-show).
      if (result?.kind === "walk_in" && result.appointmentId) {
        try {
          await cancelAppointment(result.appointmentId, actor, { reason: "Left the queue without being seen", notifyPatient: false });
        } catch (error) {
          if (!(error instanceof AppointmentError)) throw error;
        }
      }
      break;

    case "urgent":
      result = await queueTokenModel.findOneAndUpdate(
        { _id: token._id, status: "waiting" },
        { $set: { urgent: !token.urgent }, $push: { events: event("urgent", actor) } },
        { new: true }
      );
      break;

    default:
      throw new QueueError("Unknown action");
  }
  if (!result) throw new QueueError("This token was changed by someone else. Please refresh.");
  notifyTurnNearSafely(token.docId, day);
  return result;
};

// Doctor on a break (prayer, rounds, emergency) or back
export const setPaused = async (docId, paused, pauseNote = "") => {
  const day = today();
  await queueDayModel.updateOne(
    { _id: dayKey(String(docId), day) },
    {
      $set: { paused: Boolean(paused), pauseNote: paused ? String(pauseNote || "").slice(0, 120) : "" },
      $setOnInsert: { docId: String(docId), day },
    },
    { upsert: true }
  );
};

// Staff view: the queue plus today's appointments of this doctor (to check in)
export const staffView = async (docId) => {
  docId = String(docId);
  const day = today();
  const [snapshot, appointments] = await Promise.all([
    queueSnapshot(docId, day),
    appointmentModel
      .find({ docId, slotDate: day, cancelled: { $ne: true }, isCompleted: { $ne: true } })
      .sort({ startAt: 1 })
      .select("slotTime status type userId userData.name userData.phone amount")
      .lean(),
  ]);
  const checkedIn = new Set(snapshot.tokens.filter((t) => t.appointmentId).map((t) => t.appointmentId));
  const tokens = snapshot.tokens.map((t) => ({
    ...t,
    trackUrl: trackUrl(t.publicId),
    ...(t.status === "waiting" && { estimate: estimateFor(snapshot, t._id) }),
  }));
  return {
    day,
    paused: snapshot.paused,
    pauseNote: snapshot.pauseNote,
    started: snapshot.started,
    avgMinutes: snapshot.avgMinutes,
    current: snapshot.current ? tokens.find((t) => String(t._id) === String(snapshot.current._id)) : null,
    waiting: snapshot.waiting.map((w) => tokens.find((t) => String(t._id) === String(w._id))),
    tokens,
    appointmentsToCheckIn: appointments
      // Walk-in visits already have their token
      .filter((a) => !checkedIn.has(String(a._id)) && a.type !== "walk_in")
      .map((a) => ({
        _id: a._id,
        userId: a.userId,
        slotTime: a.slotTime,
        patientName: a.userData?.name,
        phone: a.userData?.phone,
        amount: a.amount,
        noShow: a.status === "no_show",
      })),
    counts: {
      issued: tokens.length,
      waiting: snapshot.waiting.length,
      done: tokens.filter((t) => t.status === "done").length,
      skipped: tokens.filter((t) => t.status === "skipped").length,
      left: tokens.filter((t) => t.status === "left").length,
      walkIns: tokens.filter((t) => t.kind === "walk_in" && t.status !== "left").length,
      // Fees of walk-ins seen today (appointment fees are already on the appointments)
      walkInFees: tokens
        .filter((t) => t.kind === "walk_in" && t.status === "done")
        .reduce((sum, t) => sum + (Number(t.fee) || 0), 0),
    },
    whatsappLinks: Boolean(publicSiteUrl()),
  };
};

// --- Public (no login): waiting-room screen and the patient's own token ---
// Only token numbers and doctor names; never patient names or phone numbers.

export const publicBoard = async () => {
  const day = today();
  const docIds = await queueTokenModel.distinct("docId", { day });
  const doctors = await doctorModel.find({ _id: { $in: docIds } }).select("name speciality").lean();
  const boards = await Promise.all(
    doctors.map(async (doctor) => {
      const snapshot = await queueSnapshot(String(doctor._id), day);
      return {
        docId: String(doctor._id),
        doctorName: doctor.name,
        speciality: doctor.speciality,
        nowServing: snapshot.current?.number ?? null,
        next: snapshot.waiting.slice(0, 6).map((t) => t.number),
        waitingCount: snapshot.waiting.length,
        paused: snapshot.paused,
        pauseNote: snapshot.pauseNote,
        started: snapshot.started,
      };
    })
  );
  return { day, serverTime: new Date(), doctors: boards.sort((a, b) => a.doctorName.localeCompare(b.doctorName)) };
};

export const publicToken = async (publicId) => {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(publicId || "")) return null;
  const token = await queueTokenModel.findOne({ publicId }).lean();
  if (!token) return null;
  const doctor = await doctorModel.findById(token.docId).select("name speciality").lean();
  const isToday = token.day === today();
  const snapshot = isToday ? await queueSnapshot(token.docId, token.day) : null;
  const estimate = snapshot && token.status === "waiting" ? estimateFor(snapshot, token._id) : null;
  return {
    number: token.number,
    day: token.day,
    isToday,
    status: token.status,
    urgent: token.urgent,
    doctorName: doctor?.name || "",
    speciality: doctor?.speciality || "",
    nowServing: snapshot?.current?.number ?? null,
    ahead: estimate?.ahead ?? null,
    waitMinutes: estimate?.waitMinutes ?? null,
    paused: snapshot?.paused || false,
    pauseNote: snapshot?.pauseNote || "",
    started: snapshot?.started || false,
    serverTime: new Date(),
  };
};

// Has every patient got phoneKeys yet (config/migrations.js)? Checked until it has.
let phoneKeysReady = false;
const phoneKeysIndexed = async () => {
  if (!phoneKeysReady) {
    phoneKeysReady = Boolean(await mongoose.connection.collection("migrations").findOne({ _id: "patient-phoneKeys" }));
  }
  return phoneKeysReady;
};

// Find patients for reception: by phone (any format), CNIC, or name. Family members
// sharing a phone all appear, so reception picks the right one.
export const searchPatients = async (query) => {
  const text = String(query || "").trim().slice(0, 60);
  if (text.length < 2) return [];
  const digits = text.replace(/\D/g, "");
  let filter;
  if (digits.length === 13 && digits === text.replace(/[-\s]/g, "")) filter = { cnic: digits };
  else if (digits.length >= 4 && digits.length >= text.replace(/[\s+()-]/g, "").length - 1) {
    // Match the number however it was typed or stored: 0300..., 92300..., +92300...
    const core = digits.replace(/^(0092|92|0)/, "");
    // A full number: an indexed lookup (was reading every patient: ~200 ms at 50,000).
    // Part of a number: matched anywhere in the stored numbers, as before.
    filter =
      core.length >= 10 && (await phoneKeysIndexed())
        ? { phoneKeys: core.slice(-10) }
        : { $or: [{ phone: { $regex: core } }, { whatsappNumber: { $regex: core } }] };
  } else {
    filter = { name: { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } };
  }
  const now = new Date();
  const users = await userModel.find(filter).select("name phone gender dob cnic whatsappEnabled whatsappNumber language").limit(10).lean();
  return users.map((u) => ({
    _id: u._id,
    name: u.name,
    phone: u.phone || "",
    gender: u.gender || "",
    age: u.dob ? ageLabel(u.dob, now) : undefined,
    cnicLast4: u.cnic ? u.cnic.slice(-4) : undefined,
    whatsappEnabled: Boolean(u.whatsappEnabled),
    language: u.language,
  }));
};
