import mongoose from "mongoose";
import userModel from "../model/userModel.js";
import appointmentModel from "../model/appointmentModel.js";
import { slotToDate } from "../utils/slots.js";

// Small database updates that run once at startup and are safe to run again.
// They never stop the server: a failure is logged and the app keeps working.

// Patients used to need a unique phone number. Families share phones, so the
// unique index on phone is replaced by a normal one (still fast to search).
const patientPhoneIndex = async () => {
  const indexes = await userModel.collection.indexes().catch(() => []);
  const phone = indexes.find((i) => i.key && Object.keys(i.key).length === 1 && i.key.phone === 1);
  if (phone?.unique) {
    await userModel.collection.dropIndex(phone.name);
    console.log("Migration: patient phone numbers no longer need to be unique (families can share one)");
  }
  await userModel.createIndexes();
};

// Appointments from before `startAt` existed get it from their slot date and time,
// so lists can filter and page by date in the database. Done once per database:
// a marker in the "migrations" collection stops it rescanning on every start
// (on Vercel that is every cold start).
const appointmentStartAt = async () => {
  const done = mongoose.connection.collection("migrations");
  if (await done.findOne({ _id: "appointment-startAt" })) return;
  const missing = await appointmentModel.collection
    .find({ startAt: { $exists: false } })
    .project({ slotDate: 1, slotTime: 1 })
    .toArray();
  const updates = missing
    .map((a) => ({ _id: a._id, startAt: slotToDate(a.slotDate, a.slotTime) }))
    .filter((a) => a.startAt)
    .map((a) => ({ updateOne: { filter: { _id: a._id, startAt: { $exists: false } }, update: { $set: { startAt: a.startAt } } } }));
  if (updates.length) {
    await appointmentModel.collection.bulkWrite(updates, { ordered: false });
    console.log(`Migration: added the appointment time (startAt) to ${updates.length} older appointment(s)`);
  }
  await done.updateOne({ _id: "appointment-startAt" }, { $set: { at: new Date(), updated: updates.length } }, { upsert: true });
};

export const runMigrations = async () => {
  for (const [name, step] of [
    ["patient phone index", patientPhoneIndex],
    ["appointment startAt", appointmentStartAt],
  ]) {
    try {
      await step();
    } catch (error) {
      console.error(`Migration "${name}" failed:`, error.message);
    }
  }
};
