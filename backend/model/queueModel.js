import mongoose from "mongoose";

// Live OPD queue. One token per patient visit per doctor per day.
//
// A token is either a walk-in (reception types the name and, if the patient has
// one, a phone number) or an appointment that was checked in when the patient
// arrived. Token numbers start at 1 each day for each doctor, like the paper
// tokens receptions already hand out.

const queueEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { role: String, id: String },
    action: { type: String, required: true }, // issued, called, done, skipped, back_in_line, left, urgent
  },
  { _id: false }
);

const queueTokenSchema = new mongoose.Schema({
  docId: { type: String, required: true },
  // Hospital-time date "d_m_yyyy" (same format as appointments)
  day: { type: String, required: true },
  number: { type: Number, required: true },
  kind: { type: String, enum: ["walk_in", "appointment"], required: true },
  appointmentId: { type: String },
  userId: { type: String },

  patientName: { type: String, required: true },
  phone: { type: String },
  // Optional, as told at reception (the lab needs them to read results against normal ranges)
  age: { type: String },
  gender: { type: String, enum: ["Male", "Female", "Other"] },
  // WhatsApp updates (token number, "your turn is near"), only with the patient's consent
  notify: { type: Boolean, default: false },
  language: { type: String, enum: ["ur", "en"], default: "ur" },
  fee: { type: Number },

  // waiting -> called (with the doctor) -> done
  // skipped: called but not present (can be put back in line); left: went home / removed
  status: { type: String, enum: ["waiting", "called", "done", "skipped", "left"], default: "waiting" },
  // Emergency / elderly / disabled: seen before the regular line
  urgent: { type: Boolean, default: false },
  // Order in the line. Walk-ins: arrival time. Appointments: their booked time, or
  // arrival time if they came late, so an on-time appointment isn't stuck behind
  // everyone who walked in earlier, and an early one doesn't jump the line.
  sortAt: { type: Date, required: true },

  issuedAt: { type: Date, default: Date.now },
  calledAt: { type: Date },
  doneAt: { type: Date },
  nearNotifiedAt: { type: Date },

  // Unguessable id for the patient's public "track my turn" link
  publicId: { type: String, required: true, unique: true },
  messages: {
    type: [
      new mongoose.Schema(
        { at: Date, kind: String, status: String, error: String },
        { _id: false }
      ),
    ],
    default: [],
  },
  events: { type: [queueEventSchema], default: [] },
});

queueTokenSchema.index({ docId: 1, day: 1, number: 1 }, { unique: true });
queueTokenSchema.index({ docId: 1, day: 1, status: 1, urgent: -1, sortAt: 1 });
// One token per appointment per day, even if two receptionists check in at once
queueTokenSchema.index(
  { appointmentId: 1, day: 1 },
  { unique: true, partialFilterExpression: { appointmentId: { $exists: true } } }
);

// Per doctor per day: the last token number given out, and whether the doctor is on a break
const queueDaySchema = new mongoose.Schema({
  _id: { type: String }, // `${docId}_${day}`
  docId: { type: String, required: true },
  day: { type: String, required: true },
  lastNumber: { type: Number, default: 0 },
  // Short lock while a "call next" runs, so two at once can't both call someone
  callLockUntil: { type: Date },
  callLockId: { type: String }, // who holds it: only they release it
  paused: { type: Boolean, default: false },
  pauseNote: { type: String, default: "" },
});

export const queueTokenModel =
  mongoose.models.queueToken || mongoose.model("queueToken", queueTokenSchema);
export const queueDayModel =
  mongoose.models.queueDay || mongoose.model("queueDay", queueDaySchema);
