// Checks for prescriptions: a doctor writes one for an appointment or a walk-in,
// picking medicines from the hospital pharmacy's list (names and stock only, never
// prices); the pharmacy gets it in its queue, dispenses it at the counter (the
// prescribed item, a substitute, or what it chose for a written-in medicine), or
// closes it; the doctor sees how far it got and can cancel only while nothing was
// sold. Through the real expressApp. Run with:
//   npm run check:integration
// With --no-pharmacy: a hospital without the pharmacy module (prescriptions are
// written and printed, nothing is sent).
// Needs a LOCAL MongoDB (CHECK_MONGODB_URI, default 127.0.0.1:27017).
// Uses its own throwaway database and deletes it at the end. Never loads .env.
import path from "path";
import { fileURLToPath } from "url";

const withPharmacy = !process.argv.includes("--no-pharmacy");
const uri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) {
  console.error("Refusing to run: the check database must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(backendDir, "no-such-env-file"),
  MONGODB_URI: uri,
  MONGODB_DB_NAME: "qclinics_rxcheck_" + Date.now(),
  JWT_SECRET: "check-prescriptions-secret",
  ADMIN_EMAIL: "admin@hospital.pk",
  ADMIN_PASSWORD: "admin-pass-1",
  WHATSAPP_PROVIDER: "none",
  PHARMACY_ENABLED: withPharmacy ? "true" : "false",
  APP_MODE: "",
});

const tag = withPharmacy ? "" : "[no pharmacy] ";
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${tag}${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};

const { default: app } = await import("../expressApp.js");
const mongoose = (await import("mongoose")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { default: doctorModel } = await import("../model/doctorModel.js");
const { default: userModel } = await import("../model/userModel.js");
const svc = await import("../services/appointmentService.js");
const q = await import("../services/queueService.js");
const { hospitalSlotDate } = await import("../utils/slots.js");
const { prescriptionModel } = await import("../model/prescriptionModel.js");
const { pharmacyStaffModel } = await import("../modules/pharmacy/models/staffModel.js");
const { productModel } = await import("../modules/pharmacy/models/productModel.js");
const { prescriptionModel: pharmacyRxModel } = await import("../modules/pharmacy/models/prescriptionModel.js");
const { saleModel } = await import("../modules/pharmacy/models/salesModels.js");
const { pharmacyPorts } = await import("../modules/pharmacy/index.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-prescriptions-secret", { expiresIn: "1h" });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

try {
  await call("GET", "/api/live");
  await call("GET", "/api/app/config");
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  await Promise.all([prescriptionModel.init(), pharmacyRxModel.init(), productModel.init(), saleModel.init()]);
  const admin = { atoken: sign({ role: "admin" }) };
  const reception = { atoken: sign({ role: "reception" }) };
  const doc = (name) => doctorModel.create({ name, email: `${name}@x.pk`, password: "x", image: "i", speciality: "Medicine", degree: "d", experience: "1", about: "a", fee: 1000, address: {}, date: Date.now(), timings: { start: "00:00", end: "23:59" } });
  const [docA, docB] = [await doc("Amina"), await doc("Bilal")];
  const doctorA = { dtoken: sign({ role: "doctor", id: String(docA._id) }) };
  const doctorB = { dtoken: sign({ role: "doctor", id: String(docB._id) }) };
  const patient = await userModel.create({ name: "Rehana", phone: "03001234567", dob: "1970-05-01", gender: "Female", cnic: "3520112345671" });
  const apt = await svc.bookAppointment({ patient, doctor: docA, slotDate: hospitalSlotDate(new Date(), 1), slotTime: "10:00 AM", amount: 1000, actor: { role: "admin" } });
  const aptId = String(apt._id || apt.appointment?._id);
  const token = (await q.issueToken({ docId: String(docA._id), patientName: "Walk-in Zahid", phone: "03215550000", age: "45", gender: "Male", actor: { role: "admin" } })).token;

  const write = (headers, body) => call("POST", "/api/prescriptions", headers, body);

  if (!withPharmacy) {
    let r = await call("GET", "/api/prescriptions/medicines?q=pana", doctorA);
    check("No pharmacy: medicine search is empty (the doctor writes them in)", r.status === 200 && r.data.medicines.length === 0);
    r = await write(doctorA, { appointmentId: aptId, items: [{ name: "Panadol", strength: "500 mg", dose: "1+0+1", days: 5, qtyUnits: 10 }] });
    check("No pharmacy: prescription saved, not sent", r.status === 200 && r.data.prescription.sentToPharmacy === false && r.data.message === `Prescription Rx-${r.data.prescription.rxNo} saved`, JSON.stringify(r.data));
    const id = r.data.prescription._id;
    r = await call("POST", `/api/prescriptions/${id}/send`, doctorA);
    check("No pharmacy: nothing to send to", r.status === 400);
    r = await call("POST", `/api/prescriptions/${id}/cancel`, doctorA);
    check("No pharmacy: the doctor cancels", r.status === 200 && r.data.prescription.status === "cancelled");
    r = await call("GET", `/api/prescriptions/${id}`, reception);
    check("No pharmacy: reception can look it up", r.status === 200 && r.data.prescription.pharmacy === undefined);
  } else {
    // The pharmacy's list
    const pw = await bcrypt.hash("x-pass-1234", 4);
    const [mgr, cash] = await pharmacyStaffModel.create([
      { name: "Sara", email: "sara@shop.pk", password: pw, role: "manager" },
      { name: "Ali", email: "ali@shop.pk", password: pw, role: "cashier" },
    ]);
    const manager = { ptoken: sign({ id: String(mgr._id), role: "pharmacy" }) };
    const cashier = { ptoken: sign({ id: String(cash._id), role: "pharmacy" }) };
    const product = async (body) => (await call("POST", "/api/pharmacy/products", manager, body)).data.product._id;
    const panadol = await product({ name: "Panadol", salt: "Paracetamol", strength: "500 mg", form: "tablet", unitName: "tablet", packName: "strip", unitsPerPack: 10, unitPricePaisa: 350, packPricePaisa: 3000 });
    const augmentin = await product({ name: "Augmentin", salt: "Co-amoxiclav", strength: "625 mg", form: "tablet", unitName: "tablet", unitPricePaisa: 9000 });
    const brufenSyrup = await product({ name: "Brufen Syrup", salt: "Ibuprofen", form: "syrup", unitName: "bottle", unitPricePaisa: 18000 });
    const supplier = (await call("POST", "/api/pharmacy/suppliers", manager, { name: "Supplier" })).data.supplier._id;
    await call("POST", "/api/pharmacy/purchases", manager, {
      supplierId: supplier,
      items: [
        { productId: panadol, expiry: inDays(300), packs: 5, packCostPaisa: 2500 },
        { productId: brufenSyrup, expiry: inDays(300), looseUnits: 3, packCostPaisa: 12000 },
      ],
    });

    // ---------- The doctor's medicine list ----------
    let r = await call("GET", "/api/prescriptions/medicines?q=pana", doctorA);
    const med = r.data.medicines?.[0];
    check("Doctor finds medicines by name, with stock shown", r.status === 200 && med?.name === "Panadol" && med.inStock === true);
    check("The doctor never gets prices or costs", med && !Object.keys(med).some((k) => /price|cost|paisa|stockUnits/i.test(k)), JSON.stringify(med));
    r = await call("GET", "/api/prescriptions/medicines?q=co-amox", doctorA);
    check("By salt too; out of stock shown as such", r.data.medicines[0]?.name === "Augmentin" && r.data.medicines[0].inStock === false);
    r = await call("GET", "/api/prescriptions/medicines?q=pana", reception);
    check("Reception can't search the pharmacy's list", r.status === 403);
    r = await call("GET", "/api/pharmacy/prescriptions", doctorA);
    check("A doctor can't open the pharmacy's queue", r.status === 401 || r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);

    // ---------- Writing prescriptions ----------
    r = await write(doctorB, { appointmentId: aptId, items: [{ name: "X" }] });
    check("Another doctor's appointment: refused", r.status === 400 && r.data.message === "Appointment not found");
    r = await write(doctorA, { appointmentId: aptId, items: [] });
    check("No medicines: refused", r.status === 400);
    r = await write(doctorA, {
      appointmentId: aptId,
      items: [
        { productId: panadol, name: "Panadol", strength: "500 mg", form: "tablet", dose: "1+0+1", days: 5, qtyUnits: 10, instructions: "After food" },
        { name: "Syp Brufen", dose: "2 spoons", days: 3, qtyUnits: 1 },
      ],
      note: "Plenty of fluids",
    });
    const rx1 = r.data.prescription;
    check("Prescription written and sent to the pharmacy", r.status === 200 && rx1.rxNo === 1 && rx1.sentToPharmacy && rx1.patient.name === "Rehana" && r.data.message === "Prescription Rx-1 sent to the pharmacy", JSON.stringify(r.data));
    r = await write(doctorA, { queueTokenId: String(token._id), items: [{ productId: augmentin, name: "Augmentin", dose: "1+0+1", days: 7, qtyUnits: 14 }] });
    const rx2 = r.data.prescription;
    check("For a walk-in from the queue", r.status === 200 && rx2.patient.name === "Walk-in Zahid" && /^45/.test(rx2.patient.age), JSON.stringify(r.data));
    r = await write(doctorA, { appointmentId: aptId, items: [{ productId: String(new mongoose.Types.ObjectId()), name: "Something old" }] });
    const rx3 = r.data.prescription;
    const rx3Pharmacy = await pharmacyRxModel.findOne({ hospitalRxId: rx3._id }).lean();
    check("A medicine the pharmacy doesn't have arrives as written-in", rx3Pharmacy && !rx3Pharmacy.items[0].productId);
    await pharmacyPorts.receivePrescription({ hospitalRxId: rx1._id, rxNo: 1, patient: {}, doctor: {}, items: [] });
    check("Sending the same prescription again doesn't duplicate it", (await pharmacyRxModel.countDocuments({ hospitalRxId: rx1._id })) === 1);

    // ---------- The pharmacy's queue ----------
    r = await call("GET", "/api/pharmacy/prescriptions", cashier);
    check("Pharmacy queue: all three waiting, oldest first", r.status === 200 && r.data.prescriptions.map((p) => p.rxNo).join() === "1,2,3");
    r = await call("GET", "/api/pharmacy/prescriptions/count", cashier);
    check("Waiting count for the menu badge", r.data.open === 3);
    r = await call("GET", "/api/pharmacy/prescriptions?q=zahid", cashier);
    check("Find by patient name", r.data.prescriptions.length === 1 && r.data.prescriptions[0].rxNo === 2);
    r = await call("GET", "/api/pharmacy/prescriptions?q=1", cashier);
    check("Find by prescription number", r.data.prescriptions.some((p) => p.rxNo === 1));
    const pharmacyRx1 = (await pharmacyRxModel.findOne({ hospitalRxId: rx1._id }).lean())._id;
    const pharmacyRx2 = (await pharmacyRxModel.findOne({ hospitalRxId: rx2._id }).lean())._id;
    const pharmacyRx3 = rx3Pharmacy._id;

    // ---------- Dispensing at the counter ----------
    await call("POST", "/api/pharmacy/shifts/open", cashier, { openingCashPaisa: 0 });
    const sell = (body) => call("POST", "/api/pharmacy/sales", cashier, { paymentMethod: "cash", ...body });
    r = await sell({ prescriptionId: String(pharmacyRx1), items: [{ productId: panadol, qtyUnits: 10, rxLine: 0 }] });
    check("Panadol sold against Rx-1: partly dispensed", r.status === 200 && r.data.sale.rxNo === 1, JSON.stringify(r.data));
    let mine = (await call("GET", `/api/prescriptions/${rx1._id}`, doctorA)).data.prescription;
    check("The doctor sees it partly dispensed, with the bill number", mine.pharmacy?.status === "partly" && mine.pharmacy.saleNos.length === 1 && mine.pharmacy.items[0].dispensedUnits === 10);
    r = await call("POST", `/api/prescriptions/${rx1._id}/cancel`, doctorA);
    check("Can't cancel once the pharmacy has started", r.status === 409);
    r = await sell({ prescriptionId: String(pharmacyRx1), items: [{ productId: brufenSyrup, qtyUnits: 1, rxLine: 1 }, { productId: panadol, qtyUnits: 1, rxLine: 99 }] });
    check("The written-in syrup sold as Brufen Syrup: fully dispensed", r.status === 200);
    mine = (await call("GET", `/api/prescriptions/${rx1._id}`, doctorA)).data.prescription;
    check("The doctor sees it dispensed", mine.pharmacy?.status === "dispensed" && mine.pharmacy.dispensedAt && mine.pharmacy.saleNos.length === 2);
    const stock = (await productModel.findById(panadol).lean()).stockUnits;
    const sales = await saleModel.countDocuments();
    r = await sell({ prescriptionId: String(pharmacyRx1), items: [{ productId: panadol, qtyUnits: 2, rxLine: 0 }] });
    check("Selling against a dispensed prescription: refused, nothing changes", r.status === 409 && r.data.code === "rx_not_open" && (await productModel.findById(panadol).lean()).stockUnits === stock && (await saleModel.countDocuments()) === sales);
    r = await sell({ prescriptionId: String(pharmacyRx2), items: [{ productId: augmentin, qtyUnits: 14, rxLine: 0 }] });
    check("Out of stock against a prescription: refused, the prescription still waits", r.status === 409 && r.data.code === "insufficient_stock" && (await pharmacyRxModel.findById(pharmacyRx2).lean()).status === "waiting" && (await pharmacyRxModel.findById(pharmacyRx2).lean()).items[0].dispensedUnits === 0);

    // ---------- Cancelled by the doctor, closed by the pharmacy ----------
    r = await call("POST", `/api/prescriptions/${rx2._id}/cancel`, doctorB);
    check("Another doctor can't cancel it", r.status === 404);
    r = await call("POST", `/api/prescriptions/${rx2._id}/cancel`, doctorA);
    check("The doctor cancels a waiting prescription", r.status === 200 && r.data.prescription.status === "cancelled" && r.data.prescription.pharmacy.status === "cancelled");
    r = await sell({ prescriptionId: String(pharmacyRx2), items: [{ productId: panadol, qtyUnits: 1, rxLine: 0 }] });
    check("A cancelled prescription can't be dispensed", r.status === 409);
    r = await call("POST", `/api/pharmacy/prescriptions/${pharmacyRx3}/close`, cashier, { note: "" });
    check("Closing needs a note", r.status === 400);
    r = await call("POST", `/api/pharmacy/prescriptions/${pharmacyRx3}/close`, cashier, { note: "Patient will buy later" });
    check("The pharmacy closes one the patient didn't buy", r.status === 200 && r.data.prescription.status === "closed");
    mine = (await call("GET", `/api/prescriptions/${rx3._id}`, doctorA)).data.prescription;
    check("The doctor sees it closed, with the pharmacy's note", mine.pharmacy?.status === "closed" && mine.pharmacy.closedNote === "Patient will buy later");
    r = await call("GET", "/api/pharmacy/prescriptions", cashier);
    check("The queue is empty now", r.data.prescriptions.length === 0);
    r = await call("GET", "/api/pharmacy/prescriptions?status=all", cashier);
    check("All prescriptions: newest first", r.data.prescriptions.map((p) => p.rxNo).join() === "3,2,1");

    // ---------- Who sees what ----------
    r = await call("GET", "/api/prescriptions", doctorB);
    check("A doctor sees only their own", r.status === 200 && r.data.prescriptions.length === 0);
    r = await call("GET", `/api/prescriptions/${rx1._id}`, doctorB);
    check("Another doctor's prescription: not found", r.status === 404);
    r = await call("GET", `/api/prescriptions?appointmentId=${aptId}`, admin);
    check("Admin finds the prescriptions of a visit", r.status === 200 && r.data.prescriptions.length === 2);
    r = await call("GET", "/api/prescriptions", cashier);
    check("Pharmacy staff can't open the hospital's prescriptions", r.status === 401 || r.status === 403);
  }
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : `\nALL PRESCRIPTION CHECKS PASSED${withPharmacy ? "" : " (no pharmacy)"}`);
  process.exit(failures ? 1 : 0);
}
