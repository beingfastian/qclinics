// Appointment lists for the staff screens (All Appointments, the doctor's
// Appointments and dashboard, Manage a Day), filtered and paged in the database.
//
// Loading every appointment ever made and filtering in the browser stops working
// as a hospital grows: two years of data was 80 MB, and Vercel refuses responses
// over 4.5 MB. These lists return one page at a time plus the counts the screens show.
//
// Same rules as the screens had in the browser:
//   range   today | upcoming | past | all   (hospital days)
//   status  pending (booked or in queue) | completed | no_show | cancelled
//   notify  whatsapp | email (patients without WhatsApp)
//   q       patient name, phone or WhatsApp number, or doctor name (any part, any case)
//   day     one slot date ("d_m_yyyy"), e.g. for Manage a Day
// Today and upcoming are soonest first; past and all are newest first.
import mongoose from "mongoose";
import appointmentModel from "../model/appointmentModel.js";
import { hospitalIsoDate, HOSPITAL_UTC_OFFSET_MINUTES, isValidSlotDate } from "../utils/slots.js";

export const RANGES = ["today", "upcoming", "past", "all"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Fields no list screen reads, left out so each row stays small. History keeps
// only what happened (the screens check for "checked_in").
export const LIST_PROJECTION = {
  notifications: 0,
  reminders: 0,
  "history.at": 0,
  "history.by": 0,
  "history.from": 0,
  "history.to": 0,
  "history.reason": 0,
  "userData.password": 0,
  "docData.password": 0,
  "docData.slots_booked": 0,
  "docData.about": 0,
  "docData.address": 0,
  "docData.degree": 0,
  "docData.experience": 0,
  "docData.email": 0,
  "docData.timings": 0,
  "docData.sittingDays": 0,
  "docData.holidays": 0,
  "docData.hospitalSharePercent": 0,
  "docData.shareHistory": 0,
  "docData.whatsappNumber": 0,
  "docData.whatsappConsentAt": 0,
};

// Start of a hospital day, as a real moment
const dayStart = (offsetDays = 0, now = new Date()) => {
  const iso = hospitalIsoDate(now);
  return new Date(Date.parse(`${iso}T00:00:00Z`) + offsetDays * 86400000 - HOSPITAL_UTC_OFFSET_MINUTES * 60000);
};

const rangeFilter = (range, now) => {
  if (range === "today") return { startAt: { $gte: dayStart(0, now), $lt: dayStart(1, now) } };
  if (range === "upcoming") return { startAt: { $gte: dayStart(1, now) } };
  if (range === "past") return { startAt: { $lt: dayStart(0, now) } };
  return {};
};

const STATUS_FILTERS = {
  pending: { cancelled: { $ne: true }, isCompleted: { $ne: true }, status: { $ne: "no_show" } },
  completed: { isCompleted: true },
  no_show: { status: "no_show" },
  cancelled: { cancelled: true },
};

const NOTIFY_FILTERS = {
  whatsapp: { "userData.whatsappEnabled": true },
  email: { "userData.whatsappEnabled": { $ne: true } },
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The filters except the range (counts per range use these too)
const baseFilter = ({ docId, status, notify, q, day }) => {
  const filter = {};
  if (docId) filter.docId = String(docId);
  if (day && isValidSlotDate(day)) filter.slotDate = day;
  Object.assign(filter, STATUS_FILTERS[status] || {}, NOTIFY_FILTERS[notify] || {});
  const text = String(q || "").trim().slice(0, 60);
  if (text) {
    const pattern = new RegExp(escapeRegex(text), "i");
    filter.$or = [
      { "userData.name": pattern },
      { "userData.phone": pattern },
      { "userData.whatsappNumber": pattern },
      { "docData.name": pattern },
    ];
  }
  return filter;
};

// Cursor = the last row's position in the sort order: "<startAt ms>_<id>"
const encodeCursor = (row) => `${new Date(row.startAt).getTime()}_${row._id}`;
const decodeCursor = (cursor) => {
  const match = /^(-?\d{1,15})_([a-f0-9]{24})$/.exec(String(cursor || ""));
  return match ? { startAt: new Date(Number(match[1])), id: new mongoose.Types.ObjectId(match[2]) } : null;
};

export const parseListQuery = (query = {}) => ({
  range: RANGES.includes(query.range) ? query.range : "all",
  docId: query.docId && query.docId !== "all" && mongoose.isValidObjectId(query.docId) ? String(query.docId) : undefined,
  status: STATUS_FILTERS[query.status] ? query.status : undefined,
  notify: NOTIFY_FILTERS[query.notify] ? query.notify : undefined,
  q: typeof query.q === "string" ? query.q : undefined,
  day: isValidSlotDate(query.day) ? query.day : undefined,
  limit: Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT)),
  cursor: typeof query.cursor === "string" ? query.cursor : undefined,
  withCounts: query.counts !== "0",
});

// One page of appointments. options: the result of parseListQuery (docId forced
// by the caller for a doctor). The first page (no cursor) also returns counts.
export const listAppointments = async (options, now = new Date()) => {
  const { range, limit, cursor, withCounts } = options;
  const base = baseFilter(options);
  const filter = { ...base, ...rangeFilter(range, now) };
  const ascending = range === "today" || range === "upcoming";
  const direction = ascending ? 1 : -1;

  const after = decodeCursor(cursor);
  const pageFilter = after
    ? {
        $and: [
          filter,
          {
            $or: [
              { startAt: { [ascending ? "$gt" : "$lt"]: after.startAt } },
              { startAt: after.startAt, _id: { [ascending ? "$gt" : "$lt"]: after.id } },
            ],
          },
        ],
      }
    : filter;

  const rows = await appointmentModel
    .find(pageFilter, LIST_PROJECTION)
    .sort({ startAt: direction, _id: direction })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const appointments = hasMore ? rows.slice(0, limit) : rows;

  // The follow-up booked from each visit on this page (shown under the visit)
  const ids = appointments.map((a) => String(a._id));
  if (ids.length) {
    const followUps = await appointmentModel
      .find({ parentAppointmentId: { $in: ids }, cancelled: { $ne: true } })
      .select("parentAppointmentId slotDate slotTime")
      .lean();
    const byParent = new Map(followUps.map((f) => [f.parentAppointmentId, { _id: f._id, slotDate: f.slotDate, slotTime: f.slotTime }]));
    for (const a of appointments) {
      const followUp = byParent.get(String(a._id));
      if (followUp) a.followUp = followUp;
    }
  }

  const result = {
    appointments,
    nextCursor: hasMore ? encodeCursor(appointments.at(-1)) : null,
  };

  if (withCounts && !after) {
    // Tab counts (whole range, no other filters, like the screens showed) and the
    // status summary of everything matching the filters (not just this page)
    const scope = { ...(options.docId && { docId: options.docId }), ...(options.day && { slotDate: options.day }) };
    const [today, upcoming, past, all, summaryRows] = await Promise.all([
      ...RANGES.map((r) => appointmentModel.countDocuments({ ...scope, ...rangeFilter(r, now) })),
      appointmentModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            cancelled: { $sum: { $cond: [{ $eq: ["$cancelled", true] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $and: [{ $ne: ["$cancelled", true] }, { $eq: ["$isCompleted", true] }] }, 1, 0] } },
            noShow: {
              $sum: {
                $cond: [{ $and: [{ $ne: ["$cancelled", true] }, { $ne: ["$isCompleted", true] }, { $eq: ["$status", "no_show"] }] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);
    const s = summaryRows[0] || { total: 0, cancelled: 0, completed: 0, noShow: 0 };
    result.counts = { today, upcoming, past, all };
    result.summary = {
      total: s.total,
      open: s.total - s.cancelled - s.completed - s.noShow,
      completed: s.completed,
      noShow: s.noShow,
      cancelled: s.cancelled,
    };
  }
  return result;
};
