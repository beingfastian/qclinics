// Prescriptions: the doctor writes one for a visit (appointment or queue token),
// picking medicines from the hospital pharmacy's list when there is one (only
// names and whether they're in stock; never prices) or writing them in. It is
// printed for the patient and, with the pharmacy module on, sent to the pharmacy,
// whose dispensing status the doctor then sees. The pharmacy is reached only
// through its ports (modules/pharmacy/ports.js).
import mongoose from "mongoose";
import { prescriptionModel, nextRxNumber } from "../model/prescriptionModel.js";
import doctorModel from "../model/doctorModel.js";
import { resolveVisitPatient, visitPatientSnapshot } from "./visitPatient.js";
import { pharmacyEnabled } from "../config/modules.js";
import { pharmacyPorts } from "../modules/pharmacy/index.js";

// An error whose message is safe to show to staff
export class RxError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => new RxError(message);

const entry = (action, actor) => ({ at: new Date(), by: { role: actor.role, ...(actor.id && { id: actor.id }), name: actor.name }, action });

// Hand a prescription to the pharmacy. A failure doesn't lose the prescription:
// it stays "not sent" and can be sent again.
const sendToPharmacy = async (rx) => {
  if (!pharmacyEnabled()) return false;
  try {
    await pharmacyPorts.receivePrescription({
      hospitalRxId: String(rx._id),
      rxNo: rx.rxNo,
      patient: rx.patient,
      doctor: rx.doctor,
      items: rx.items,
      note: rx.note,
    });
    await prescriptionModel.updateOne({ _id: rx._id }, { $set: { sentToPharmacy: true } });
    return true;
  } catch (error) {
    console.error("Prescription not sent to the pharmacy:", error);
    return false;
  }
};

// What the pharmacy did with each one (when there is a pharmacy)
const withPharmacy = async (rows) => {
  if (!pharmacyEnabled() || !rows.length) return rows.map((r) => ({ ...r, _id: String(r._id) }));
  const statuses = await pharmacyPorts.prescriptionStatuses(rows.filter((r) => r.sentToPharmacy).map((r) => String(r._id)));
  return rows.map((r) => ({ ...r, _id: String(r._id), pharmacy: statuses[String(r._id)] || null }));
};

export const medicineSearch = async (q) => (pharmacyEnabled() ? pharmacyPorts.searchMedicines(q) : []);

export const createPrescription = async ({ actor, appointmentId, queueTokenId, items, note }) => {
  const source = await resolveVisitPatient({ docId: actor.id, appointmentId, queueTokenId }, fail);
  const { user, patient } = await visitPatientSnapshot(source, fail);
  const doctor = await doctorModel.findById(actor.id).select("name speciality").lean();
  const rx = (
    await prescriptionModel.create({
      rxNo: await nextRxNumber(),
      docId: actor.id,
      doctor: { name: doctor?.name, speciality: doctor?.speciality },
      ...(user && { userId: String(user._id) }),
      patient: { ...patient, ...(patient.age && { age: String(patient.age) }) },
      ...(source.appointmentId && { appointmentId: source.appointmentId }),
      ...(source.queueTokenId && { queueTokenId: source.queueTokenId }),
      items,
      note,
      history: [entry("issued", actor)],
    })
  ).toObject();
  const sent = await sendToPharmacy(rx);
  return { ...rx, _id: String(rx._id), sentToPharmacy: sent };
};

// Doctors see their own; reception and the admin see all
const visibleTo = (actor) => (actor.role === "doctor" ? { docId: actor.id } : {});

export const listPrescriptions = async ({ appointmentId, userId, limit = 30, cursor }, actor) => {
  const filter = { ...visibleTo(actor), ...(appointmentId && { appointmentId }), ...(userId && { userId }) };
  const size = Math.min(100, limit);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const page = after
    ? { $and: [filter, { $or: [{ createdAt: { $lt: new Date(Number(after[0])) } }, { createdAt: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await prescriptionModel.find(page).sort({ createdAt: -1, _id: -1 }).limit(size + 1).select("-history").lean();
  const items = rows.slice(0, size);
  return { prescriptions: await withPharmacy(items), nextCursor: rows.length > size ? `${items.at(-1).createdAt.getTime()}_${items.at(-1)._id}` : null };
};

export const getPrescription = async (id, actor) => {
  const rx = await prescriptionModel.findOne({ _id: id, ...visibleTo(actor) }).lean();
  if (!rx) throw new RxError("Prescription not found", 404);
  return (await withPharmacy([rx]))[0];
};

// Sent again (the pharmacy couldn't be reached when it was written)
export const resend = async (id, actor) => {
  const rx = await prescriptionModel.findOne({ _id: id, ...visibleTo(actor), status: "issued" }).lean();
  if (!rx) throw new RxError("Prescription not found", 404);
  if (!pharmacyEnabled()) throw new RxError("This hospital has no pharmacy module");
  if (!(await sendToPharmacy(rx))) throw new RxError("Couldn't reach the pharmacy. Please try again.", 503);
  return getPrescription(id, actor);
};

// The doctor cancels: refused once the pharmacy has started dispensing it
export const cancelPrescription = async (id, actor) => {
  const rx = await prescriptionModel.findOne({ _id: id, ...visibleTo(actor) }).lean();
  if (!rx) throw new RxError("Prescription not found", 404);
  if (rx.status === "cancelled") return getPrescription(id, actor);
  if (pharmacyEnabled() && rx.sentToPharmacy) {
    try {
      await pharmacyPorts.cancelPrescription(String(rx._id));
    } catch (error) {
      if (error?.code === "rx_in_use") throw new RxError("The pharmacy has already started on this prescription. Ask them to close it instead.", 409);
      throw error;
    }
  }
  await prescriptionModel.updateOne({ _id: rx._id, status: "issued" }, { $set: { status: "cancelled" }, $push: { history: entry("cancelled", actor) } });
  return getPrescription(id, actor);
};
