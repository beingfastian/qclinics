// Lab orders: the doctor requests tests, the lab sees them at once, uploads the
// report, and the doctor reviews (approves or returns it with a note).
//
// Hospital workflow this follows: payment is taken at the counter as today, the
// patient walks to the lab to give samples, and the person doing the test phones
// the doctor about anything dangerous. So there are no payment or sample steps here.
import bcrypt from "bcrypt";
import validator from "validator";
import { labStaffModel, labTestModel, labOrderModel, labCounterModel } from "../model/labModel.js";
import userModel from "../model/userModel.js";
import doctorModel from "../model/doctorModel.js";
import { createNotification } from "../controllers/notificationController.js";
import { saveReport, deleteReport } from "./reportStorage.js";
import { resolveVisitPatient, visitPatientSnapshot } from "./visitPatient.js";

// An error whose message is safe to show to staff
export class LabError extends Error {}

const SAMPLE_TYPES = ["Blood", "Urine", "Stool", "Swab", "Sputum", "Imaging", "Other"];
export const sampleTypes = () => SAMPLE_TYPES;

// Tests most Pakistani hospital labs offer, so a new lab isn't starting from an empty list
const COMMON_TESTS = [
  ["CBC (Complete Blood Count)", "Blood"],
  ["ESR", "Blood"],
  ["Blood Sugar Random", "Blood"],
  ["Blood Sugar Fasting", "Blood"],
  ["HbA1c", "Blood"],
  ["LFT (Liver Function Tests)", "Blood"],
  ["RFT (Renal Function Tests)", "Blood"],
  ["Serum Electrolytes", "Blood"],
  ["Lipid Profile", "Blood"],
  ["Uric Acid", "Blood"],
  ["TSH", "Blood"],
  ["Thyroid Profile (T3, T4, TSH)", "Blood"],
  ["HBsAg (Hepatitis B)", "Blood"],
  ["Anti-HCV (Hepatitis C)", "Blood"],
  ["Typhidot", "Blood"],
  ["Malaria Parasite (MP)", "Blood"],
  ["Dengue NS1", "Blood"],
  ["CRP", "Blood"],
  ["Blood Group & Rh", "Blood"],
  ["PT / INR", "Blood"],
  ["Vitamin D", "Blood"],
  ["Serum Calcium", "Blood"],
  ["Urine R/E (Routine Examination)", "Urine"],
  ["Urine Culture & Sensitivity", "Urine"],
  ["Stool R/E", "Stool"],
  ["Pregnancy Test (Urine)", "Urine"],
  ["X-Ray Chest PA View", "Imaging"],
  ["Ultrasound Abdomen", "Imaging"],
  ["ECG", "Other"],
];

const now = () => new Date();
const entry = (action, actor, note) => ({ at: now(), by: actor, action, ...(note && { note: String(note).slice(0, 1000) }) });

// --- Live alerts: in-app notification + socket push to the room ---

const notify = async (io, { to, toType, from, fromType, type, title, message, priority, orderId }) => {
  try {
    const notification = await createNotification(to, toType, from, fromType, type, title, message, priority, orderId);
    io?.to(toType === "lab" ? "lab" : toType === "admin" ? "admin" : `doctor_${to}`).emit("newNotification", notification);
  } catch (error) {
    // An alert failing must never undo the order itself
    console.error("Lab notification failed:", error.message);
  }
};

// --- Lab staff accounts (admin manages these) ---

const publicStaff = (s) => ({ _id: s._id, name: s.name, email: s.email, phone: s.phone, active: s.active, createdAt: s.createdAt });

export const listStaff = async () => (await labStaffModel.find().sort({ createdAt: -1 }).lean()).map(publicStaff);

export const createStaff = async ({ name, email, password, phone }) => {
  name = String(name || "").trim();
  email = String(email || "").trim().toLowerCase();
  if (!name || !email || !password) throw new LabError("Name, email and password are required");
  if (!validator.isEmail(email)) throw new LabError("Please enter a valid email");
  if (String(password).length < 8) throw new LabError("Password must be at least 8 characters");
  if (await labStaffModel.exists({ email })) throw new LabError("A lab account with this email already exists");
  const staff = await labStaffModel.create({
    name,
    email,
    phone: String(phone || "").trim(),
    password: await bcrypt.hash(String(password), 10),
  });
  return publicStaff(staff);
};

export const updateStaff = async (id, { name, phone, active, password }) => {
  const update = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new LabError("Name can't be empty");
    update.name = String(name).trim();
  }
  if (phone !== undefined) update.phone = String(phone).trim();
  if (active !== undefined) update.active = Boolean(active);
  if (password) {
    if (String(password).length < 8) throw new LabError("Password must be at least 8 characters");
    update.password = await bcrypt.hash(String(password), 10);
  }
  const staff = await labStaffModel.findByIdAndUpdate(id, update, { new: true });
  if (!staff) throw new LabError("Lab account not found");
  return publicStaff(staff);
};

export const loginStaff = async (email, password) => {
  const staff = await labStaffModel.findOne({ email: String(email || "").trim().toLowerCase() });
  // Same message for unknown email and wrong password
  if (!staff || !(await bcrypt.compare(String(password || ""), staff.password))) {
    throw new LabError("Invalid Credentials");
  }
  if (!staff.active) throw new LabError("This lab account is turned off. Please contact the admin.");
  return staff;
};

// --- Test list ---

export const listTests = (includeInactive = false) =>
  labTestModel.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).lean();

const cleanTest = ({ name, sampleType, price }) => {
  const out = {};
  if (name !== undefined) {
    out.name = String(name).trim().replace(/\s+/g, " ").slice(0, 120);
    if (!out.name) throw new LabError("Please enter the test name");
  }
  if (sampleType !== undefined) out.sampleType = SAMPLE_TYPES.includes(sampleType) ? sampleType : "Other";
  if (price !== undefined) {
    if (price === "" || price === null) out.price = null; // cleared (removed in updateTest)
    else {
      const value = Number(price);
      if (!Number.isFinite(value) || value < 0) throw new LabError("Please enter a valid price");
      out.price = Math.round(value);
    }
  }
  return out;
};

const duplicateName = (error) => error?.code === 11000 && /name/.test(error.message);

export const createTest = async (data) => {
  try {
    const test = cleanTest({ sampleType: "Blood", ...data });
    if (test.price === null) delete test.price;
    return await labTestModel.create(test);
  } catch (error) {
    if (duplicateName(error)) throw new LabError("A test with this name already exists");
    throw error;
  }
};

export const updateTest = async (id, data) => {
  const update = cleanTest(data);
  if (data.active !== undefined) update.active = Boolean(data.active);
  const clearPrice = update.price === null;
  if (clearPrice) delete update.price;
  try {
    const test = await labTestModel.findByIdAndUpdate(
      id,
      { $set: update, ...(clearPrice && { $unset: { price: 1 } }) },
      { new: true, runValidators: true }
    );
    if (!test) throw new LabError("Test not found");
    return test;
  } catch (error) {
    if (duplicateName(error)) throw new LabError("A test with this name already exists");
    throw error;
  }
};

// Adds the common tests that aren't in the list yet; returns how many were added
export const addCommonTests = async () => {
  let added = 0;
  for (const [name, sampleType] of COMMON_TESTS) {
    try {
      await labTestModel.create({ name, sampleType });
      added++;
    } catch (error) {
      if (!duplicateName(error)) throw error;
    }
  }
  return added;
};

// --- Orders ---

const nextOrderNumber = async () => {
  const counter = await labCounterModel.findOneAndUpdate(
    { _id: "labOrder" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
};

export const createOrder = async ({ actor, io, appointmentId, queueTokenId, userId, testIds, urgent, note }) => {
  if (actor.role !== "doctor") throw new LabError("Only doctors can request tests");
  const docId = actor.id;

  const ids = [...new Set((Array.isArray(testIds) ? testIds : []).map(String))];
  if (!ids.length) throw new LabError("Please choose at least one test");
  if (ids.length > 40) throw new LabError("Too many tests in one request");
  const tests = await labTestModel.find({ _id: { $in: ids }, active: true }).lean();
  if (tests.length !== ids.length) throw new LabError("Some tests are no longer offered. Please refresh and choose again.");

  const fail = (message) => new LabError(message);
  const source = await resolveVisitPatient({ docId, appointmentId, queueTokenId, userId }, fail);
  const { user, patient } = await visitPatientSnapshot(source, fail);
  const doctor = await doctorModel.findById(docId).select("name speciality").lean();

  const order = await labOrderModel.create({
    orderNumber: await nextOrderNumber(),
    urgent: Boolean(urgent),
    docId,
    doctor: { name: doctor?.name, speciality: doctor?.speciality },
    ...(user && { userId: String(user._id) }),
    patient,
    ...(source.appointmentId && { appointmentId: source.appointmentId }),
    ...(source.queueTokenId && { queueTokenId: source.queueTokenId }),
    tests: tests
      .sort((a, b) => ids.indexOf(String(a._id)) - ids.indexOf(String(b._id)))
      .map((t) => ({ testId: String(t._id), name: t.name, sampleType: t.sampleType })),
    doctorNote: String(note || "").trim().slice(0, 1000),
    history: [entry("ordered", actor)],
  });

  await notify(io, {
    to: "lab",
    toType: "lab",
    from: docId,
    fromType: "doctor",
    type: "lab_order",
    title: `${order.urgent ? "URGENT: " : ""}New lab request L-${order.orderNumber}`,
    message: `Dr. ${order.doctor.name} requested ${order.tests.length} test(s) for ${order.patient.name}.`,
    priority: order.urgent ? "high" : "medium",
    orderId: String(order._id),
  });
  return order;
};

// Who may see an order: lab and admin see all; a doctor only their own
export const canSee = (actor, order) => actor.role !== "doctor" || order.docId === actor.id;

export const getOrder = async (actor, id) => {
  const order = await labOrderModel.findById(id).lean();
  if (!order || !canSee(actor, order)) throw new LabError("Lab request not found");
  return order;
};

// Patient details for the lab screen (registered patients: from their record)
export const orderPatientDetails = async (order) => {
  if (!order.userId) return { ...order.patient, walkIn: true };
  const user = await userModel.findById(order.userId).select("name phone gender dob address cnic").lean();
  if (!user) return { ...order.patient, removed: true };
  return {
    name: user.name,
    phone: user.phone,
    gender: user.gender,
    dob: user.dob,
    address: [user.address?.line1, user.address?.line2].filter(Boolean).join(", "),
    // Enough to tell two patients with the same name apart, without showing the whole CNIC
    cnicLast4: user.cnic ? String(user.cnic).slice(-4) : undefined,
    // As told at reception today (used when the record has no date of birth)
    age: order.patient?.age,
  };
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Lists. status: one status, "open" (ordered + returned), or "all".
export const listOrders = async (actor, { status = "open", search = "", days = 30, docId, userId, limit = 200 } = {}) => {
  const filter = {};
  if (actor.role === "doctor") filter.docId = actor.id;
  else if (docId) filter.docId = String(docId);
  if (userId) filter.userId = String(userId);

  if (status === "open") filter.status = { $in: ["ordered", "returned"] };
  else if (status && status !== "all") filter.status = status;

  const sinceDays = Math.min(Math.max(Number(days) || 30, 1), 3650);
  if (!userId) filter.createdAt = { $gte: new Date(Date.now() - sinceDays * 86400000) };

  const text = String(search || "").trim().slice(0, 60);
  if (text) {
    const number = /^l-?(\d+)$/i.exec(text) || /^(\d{1,3})$/.exec(text);
    const digits = text.replace(/\D/g, "");
    filter.$or = [
      { "patient.name": { $regex: escapeRegex(text), $options: "i" } },
      { "doctor.name": { $regex: escapeRegex(text), $options: "i" } },
      // Phone numbers: at least 4 digits, so "L-2" or "2" don't match every phone with a 2
      ...(digits.length >= 4 ? [{ "patient.phone": { $regex: escapeRegex(digits.replace(/^0/, "")) } }] : []),
      ...(number ? [{ orderNumber: Number(number[1]) }] : []),
    ];
  }

  return labOrderModel
    .find(filter)
    // Urgent and oldest first for work still to do; newest first otherwise
    .sort(status === "open" ? { urgent: -1, createdAt: 1 } : { createdAt: -1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .select("-history")
    .lean();
};

// Counts for badges: lab = work waiting; doctor = reports waiting for their review
export const counts = async (actor) => {
  if (actor.role === "doctor") {
    return { toReview: await labOrderModel.countDocuments({ docId: actor.id, status: "report_uploaded" }) };
  }
  const [ordered, returned, uploaded] = await Promise.all([
    labOrderModel.countDocuments({ status: "ordered" }),
    labOrderModel.countDocuments({ status: "returned" }),
    labOrderModel.countDocuments({ status: "report_uploaded" }),
  ]);
  return { open: ordered + returned, ordered, returned, waitingForDoctor: uploaded };
};

// Lab uploads the report (first time, or again after the doctor returned it)
export const uploadReport = async ({ actor, io, id, file, note }) => {
  if (actor.role !== "lab") throw new LabError("Only lab staff can upload reports");
  if (!file) throw new LabError("Please choose the report file");
  const order = await labOrderModel.findById(id);
  if (!order) throw new LabError("Lab request not found");
  if (!["ordered", "returned", "report_uploaded"].includes(order.status)) {
    throw new LabError(order.status === "approved" ? "This report is already approved" : "This request was cancelled");
  }

  const saved = await saveReport(file);
  const report = { ...saved, note: String(note || "").trim().slice(0, 1000), uploadedAt: now(), uploadedBy: actor };
  const previousStatus = order.status;
  // Only if nobody changed it meanwhile (e.g. the doctor cancelled it)
  let updated;
  try {
    updated = await labOrderModel.findOneAndUpdate(
      { _id: order._id, status: previousStatus },
      {
        $set: { status: "report_uploaded", updatedAt: now() },
        $push: { reports: report, history: entry(previousStatus === "report_uploaded" ? "report_replaced" : "report_uploaded", actor, note) },
      },
      { new: true }
    );
  } catch (error) {
    await deleteReport(saved);
    throw error;
  }
  if (!updated) {
    await deleteReport(saved);
    throw new LabError("This request was changed by someone else. Please refresh.");
  }

  await notify(io, {
    to: updated.docId,
    toType: "doctor",
    from: actor.id,
    fromType: "lab",
    type: "lab_report",
    title: `Lab report ready: ${updated.patient.name}`,
    message: `${updated.tests.map((t) => t.name).join(", ")} (L-${updated.orderNumber}) is ready for your review.`,
    priority: updated.urgent ? "high" : "medium",
    orderId: String(updated._id),
  });
  return updated;
};

// Doctor approves the report, or returns it to the lab with a note
// reportId: the report the doctor was looking at. If the lab replaced it meanwhile,
// nothing happens, so a doctor never approves a report they didn't see.
export const reviewReport = async ({ actor, io, id, decision, note, reportId }) => {
  if (actor.role !== "doctor") throw new LabError("Only the requesting doctor can review the report");
  if (!reportId) throw new LabError("Please open the report again and then review it");
  const text = String(note || "").trim().slice(0, 1000);
  if (decision === "return" && !text) throw new LabError("Please write what the lab should check or redo");
  if (!["approve", "return"].includes(decision)) throw new LabError("Unknown decision");

  const status = decision === "approve" ? "approved" : "returned";
  const updated = await labOrderModel.findOneAndUpdate(
    {
      _id: id,
      docId: actor.id,
      status: "report_uploaded",
      $expr: { $eq: [{ $toString: { $arrayElemAt: ["$reports._id", -1] } }, String(reportId)] },
    },
    {
      $set: { status, review: { at: now(), note: text }, updatedAt: now() },
      $push: { history: entry(status, actor, text) },
    },
    { new: true }
  );
  if (!updated) {
    const current = await labOrderModel.findOne({ _id: id, docId: actor.id }).select("status reports._id").lean();
    const newest = current?.reports?.[current.reports.length - 1];
    if (current?.status === "report_uploaded" && newest && String(newest._id) !== String(reportId)) {
      throw new LabError("The lab just uploaded a newer report. It is shown now; please check it before deciding.");
    }
    throw new LabError("This report can't be reviewed now (not uploaded yet, or already reviewed)");
  }

  await notify(io, {
    to: "lab",
    toType: "lab",
    from: actor.id,
    fromType: "doctor",
    type: decision === "approve" ? "lab_report_approved" : "lab_report_returned",
    title: decision === "approve" ? `Report approved: L-${updated.orderNumber}` : `Report returned: L-${updated.orderNumber}`,
    message:
      decision === "approve"
        ? `Dr. ${updated.doctor.name} approved the report for ${updated.patient.name}.`
        : `Dr. ${updated.doctor.name}: ${text}`,
    priority: decision === "approve" ? "low" : "high",
    orderId: String(updated._id),
  });
  return updated;
};

// Doctor cancels a request (e.g. ordered by mistake) while no report is approved
export const cancelOrder = async ({ actor, io, id, note }) => {
  if (actor.role !== "doctor" && actor.role !== "admin") throw new LabError("Only the doctor can cancel a request");
  const updated = await labOrderModel.findOneAndUpdate(
    { _id: id, ...(actor.role === "doctor" && { docId: actor.id }), status: { $in: ["ordered", "returned", "report_uploaded"] } },
    { $set: { status: "cancelled", updatedAt: now() }, $push: { history: entry("cancelled", actor, note) } },
    { new: true }
  );
  if (!updated) throw new LabError("This request can't be cancelled now");
  await notify(io, {
    to: "lab",
    toType: "lab",
    from: actor.id || "admin",
    fromType: actor.role,
    type: "lab_order_cancelled",
    title: `Request cancelled: L-${updated.orderNumber}`,
    message: `The tests for ${updated.patient.name} are no longer needed.`,
    priority: "medium",
    orderId: String(updated._id),
  });
  return updated;
};
