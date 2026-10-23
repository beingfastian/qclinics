// The pharmacy module's ports: the only way the hospital talks to it (index.js).
// Plain functions, so the hospital never reads or writes pharmacy_* collections and
// the pharmacy never reads hospital ones. Prescriptions come in; what the doctor
// may see about medicines (names and whether they're in stock, never prices or
// costs) and how far each prescription was dispensed go out.
import { productModel } from "./models/productModel.js";
import { prescriptionModel } from "./models/prescriptionModel.js";
import { PharmacyError } from "./http.js";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Medicines a doctor can pick from (by name or salt)
export const searchMedicines = async (q, limit = 15) => {
  const text = String(q || "").trim().toLowerCase().slice(0, 60);
  if (!text) return [];
  const prefix = new RegExp(`^${escapeRegex(text)}`);
  const rows = await productModel
    .find({ active: true, $or: [{ nameKey: prefix }, { saltKey: prefix }] })
    .sort({ nameKey: 1 })
    .limit(Math.min(30, limit))
    .select("name strength form salt unitName packName unitsPerPack stockUnits")
    .lean();
  return rows.map((p) => ({
    productId: String(p._id),
    name: p.name,
    strength: p.strength,
    form: p.form,
    salt: p.salt,
    unitName: p.unitName,
    packName: p.packName,
    unitsPerPack: p.unitsPerPack,
    inStock: p.stockUnits > 0,
  }));
};

// A prescription from a doctor. Sending the same one again changes nothing.
export const receivePrescription = async ({ hospitalRxId, rxNo, patient, doctor, items, note }) => {
  await prescriptionModel.init();
  const known = new Set(
    (await productModel.find({ _id: { $in: items.map((i) => i.productId).filter(Boolean) } }).select("_id").lean()).map((p) => String(p._id))
  );
  try {
    const rx = await prescriptionModel.create({
      hospitalRxId: String(hospitalRxId),
      rxNo,
      patient: { name: patient?.name || "", phone: patient?.phone || "", age: patient?.age ? String(patient.age) : "", gender: patient?.gender || "" },
      doctor: { name: doctor?.name || "", speciality: doctor?.speciality || "" },
      items: items.map((i) => ({
        ...(i.productId && known.has(String(i.productId)) && { productId: String(i.productId) }),
        name: i.name,
        strength: i.strength || "",
        form: i.form || "",
        dose: i.dose || "",
        ...(i.days && { days: i.days }),
        ...(i.qtyUnits && { qtyUnits: i.qtyUnits }),
        instructions: i.instructions || "",
      })),
      note: note || "",
    });
    return { id: String(rx._id), status: rx.status };
  } catch (error) {
    if (error?.code === 11000) {
      const rx = await prescriptionModel.findOne({ hospitalRxId: String(hospitalRxId) }).lean();
      return { id: String(rx._id), status: rx.status };
    }
    throw error;
  }
};

// The doctor cancels: only while nothing has been sold against it
export const cancelPrescription = async (hospitalRxId) => {
  const rx = await prescriptionModel.findOneAndUpdate({ hospitalRxId: String(hospitalRxId), status: "waiting" }, { $set: { status: "cancelled" } }, { new: true }).lean();
  if (rx) return { status: "cancelled" };
  const current = await prescriptionModel.findOne({ hospitalRxId: String(hospitalRxId) }).lean();
  if (!current) return { status: "not_sent" };
  if (current.status === "cancelled") return { status: "cancelled" };
  throw new PharmacyError("The pharmacy has already dealt with this prescription", { status: 409, code: "rx_in_use", extra: { pharmacyStatus: current.status } });
};

// How far each prescription got at the pharmacy: { hospitalRxId: { status, dispensedAt, saleNos } }
export const prescriptionStatuses = async (hospitalRxIds) => {
  const rows = await prescriptionModel
    .find({ hospitalRxId: { $in: hospitalRxIds.map(String) } })
    .select("hospitalRxId status dispensedAt sales closedNote items.name items.dispensedUnits items.qtyUnits")
    .lean();
  return Object.fromEntries(
    rows.map((r) => [
      r.hospitalRxId,
      {
        status: r.status,
        dispensedAt: r.dispensedAt,
        saleNos: (r.sales || []).map((s) => s.saleNo),
        closedNote: r.closedNote,
        items: r.items.map((i) => ({ name: i.name, dispensedUnits: i.dispensedUnits, qtyUnits: i.qtyUnits })),
      },
    ])
  );
};
