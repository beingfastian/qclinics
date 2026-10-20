import mongoose from "mongoose";

// Who did something: role + id (staff/doctor id, or "admin" / "whatsapp")
const actorSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["admin", "doctor", "patient", "system"], required: true },
    id: { type: String },
  },
  { _id: false }
);

// One entry per change, newest last
const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: actorSchema },
    action: {
      type: String,
      // checked_in: the patient arrived and got a queue token
      enum: ["booked", "follow_up_booked", "completed", "cancelled", "no_show", "rescheduled", "checked_in"],
      required: true,
    },
    from: { slotDate: String, slotTime: String },
    to: { slotDate: String, slotTime: String },
    reason: { type: String },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  docId: { type: String, required: true },
  // Hospital-time date "d_m_yyyy" and time "hh:mm AM" (also used for slot reservation)
  slotDate: { type: String, required: true },
  slotTime: { type: String, required: true },
  // The same moment as a real date (UTC), for sorting, reminders and reports
  startAt: { type: Date },
  durationMinutes: { type: Number, default: 30 },
  userData: { type: Object, required: true },
  docData: { type: Object, required: true },
  amount: { type: Number, required: true },
  date: { type: Number, required: true }, // when it was booked (ms)

  // Lifecycle. `cancelled` / `isCompleted` are kept in sync for existing screens.
  status: {
    type: String,
    enum: ["booked", "completed", "cancelled", "no_show"],
    default: "booked",
  },
  cancelled: { type: Boolean, default: false },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date },
  // How the fee was split when the visit was completed (services/profitService.js),
  // so a later change to the doctor's share never rewrites past profit.
  // hospital + doctor = amount.
  share: {
    percent: { type: Number }, // hospital's share, in percent
    hospital: { type: Number },
    doctor: { type: Number },
  },

  // "new" booked visit, a "follow_up" scheduled from an earlier visit, or a "walk_in"
  // created when reception gives a queue token to a patient without an appointment
  type: { type: String, enum: ["new", "follow_up", "walk_in"], default: "new" },
  parentAppointmentId: { type: String },
  createdBy: { type: actorSchema },
  history: { type: [historySchema], default: [] },

  // --- Admin/discount/cnic fields ---
  discountPercent: { type: Number, default: 0 }, // Discount applied (if any)
  finalFee: { type: Number }, // Final fee after discount (if any)
  cnic: { type: String }, // Patient CNIC (for admin bookings)
  // Outcome of each WhatsApp/email sent in the background (see services/notificationQueue.js)
  notifications: {
    type: [
      new mongoose.Schema(
        {
          at: Date,
          channel: { type: String, enum: ["whatsapp", "email"] },
          recipient: { type: String, enum: ["patient", "doctor"] },
          kind: String,
          status: { type: String, enum: ["sent", "failed"] },
          error: String,
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  // When WhatsApp reminders were sent (or skipped), so each is sent only once
  reminders: {
    dayBefore: { type: Date },
    beforeStart: { type: Date },
  },
});

appointmentSchema.index({ docId: 1, startAt: 1 });
// Paged lists (services/appointmentListService.js) sort by startAt then _id
appointmentSchema.index({ startAt: 1, _id: 1 });
appointmentSchema.index({ docId: 1, startAt: 1, _id: 1 });
appointmentSchema.index({ userId: 1, startAt: -1 });
appointmentSchema.index({ parentAppointmentId: 1 });

const appointmentModel =
  mongoose.models.appointment ||
  mongoose.model("appointment", appointmentSchema);

export default appointmentModel;
