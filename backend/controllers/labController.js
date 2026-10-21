import fs from "fs";
import { pipeline } from "stream";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import * as lab from "../services/labService.js";
import { openReport, reportStorageName } from "../services/reportStorage.js";
import { labOrderModel } from "../model/labModel.js";

// Lab module on/off for this hospital (LAB_ENABLED=false hides it)
import { labEnabled } from "../config/modules.js";
export { labEnabled };

export const requireLabEnabled = (req, res, next) =>
  labEnabled() ? next() : res.status(404).json({ success: false, message: "The lab module is turned off" });

// Errors staff can act on are shown; anything else is logged and kept generic
const fail = (res, error) => {
  const safe = error instanceof lab.LabError;
  if (!safe) console.error("Lab error:", error);
  res.json({ success: false, message: safe ? error.message : "Something went wrong. Please try again." });
};

const validId = (id) => mongoose.isValidObjectId(id);
const io = (req) => req.app.get("io");

// --- Public ---

export const status = (req, res) => res.json({ success: true, enabled: labEnabled() });

export const login = async (req, res) => {
  try {
    const staff = await lab.loginStaff(req.body.email, req.body.password);
    const token = jwt.sign({ id: staff._id, role: "lab" }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    });
    res.json({ success: true, token, staff: { name: staff.name, email: staff.email } });
  } catch (error) {
    fail(res, error);
  }
};

export const me = (req, res) => res.json({ success: true, staff: { name: req.actor.name, id: req.actor.id } });

// --- Lab staff accounts (admin) ---

export const staffList = async (req, res) => {
  try {
    res.json({ success: true, staff: await lab.listStaff() });
  } catch (error) {
    fail(res, error);
  }
};
export const staffCreate = async (req, res) => {
  try {
    res.json({ success: true, message: "Lab account created", staff: await lab.createStaff(req.body) });
  } catch (error) {
    fail(res, error);
  }
};
export const staffUpdate = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab account not found" });
    res.json({ success: true, message: "Lab account updated", staff: await lab.updateStaff(req.params.id, req.body) });
  } catch (error) {
    fail(res, error);
  }
};

// --- Test list ---

export const testList = async (req, res) => {
  try {
    // Doctors only see tests that can be ordered; lab/admin also see turned-off ones
    const all = req.actor.role !== "doctor" && req.query.all === "true";
    res.json({ success: true, tests: await lab.listTests(all), sampleTypes: lab.sampleTypes() });
  } catch (error) {
    fail(res, error);
  }
};
export const testCreate = async (req, res) => {
  try {
    res.json({ success: true, message: "Test added", test: await lab.createTest(req.body) });
  } catch (error) {
    fail(res, error);
  }
};
export const testUpdate = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Test not found" });
    res.json({ success: true, message: "Test updated", test: await lab.updateTest(req.params.id, req.body) });
  } catch (error) {
    fail(res, error);
  }
};
export const testAddCommon = async (req, res) => {
  try {
    const added = await lab.addCommonTests();
    res.json({ success: true, message: added ? `${added} common tests added` : "All common tests are already in the list", added });
  } catch (error) {
    fail(res, error);
  }
};

// --- Orders ---

export const orderCreate = async (req, res) => {
  try {
    const { appointmentId, queueTokenId, userId, testIds, urgent, note } = req.body;
    for (const id of [appointmentId, queueTokenId, userId]) {
      if (id && !validId(id)) return res.json({ success: false, message: "Patient not found" });
    }
    if (Array.isArray(testIds) && testIds.some((id) => !validId(id))) {
      return res.json({ success: false, message: "Please choose the tests again" });
    }
    const order = await lab.createOrder({ actor: req.actor, io: io(req), appointmentId, queueTokenId, userId, testIds, urgent, note });
    res.json({ success: true, message: `Sent to the lab (L-${order.orderNumber})`, order });
  } catch (error) {
    fail(res, error);
  }
};

export const orderList = async (req, res) => {
  try {
    const { status: wanted, search, days, docId, userId } = req.query;
    if ((docId && !validId(docId)) || (userId && !validId(userId))) return res.json({ success: true, orders: [] });
    const [orders, badgeCounts] = await Promise.all([
      lab.listOrders(req.actor, { status: wanted, search, days, docId, userId }),
      lab.counts(req.actor),
    ]);
    res.json({ success: true, orders, counts: badgeCounts });
  } catch (error) {
    fail(res, error);
  }
};

export const orderCounts = async (req, res) => {
  try {
    res.json({ success: true, counts: await lab.counts(req.actor) });
  } catch (error) {
    fail(res, error);
  }
};

export const orderGet = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab request not found" });
    const order = await lab.getOrder(req.actor, req.params.id);
    res.json({ success: true, order, patient: await lab.orderPatientDetails(order) });
  } catch (error) {
    fail(res, error);
  }
};

export const orderUpload = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab request not found" });
    const order = await lab.uploadReport({ actor: req.actor, io: io(req), id: req.params.id, file: req.file, note: req.body.note });
    res.json({ success: true, message: "Report sent to the doctor", order });
  } catch (error) {
    fail(res, error);
  } finally {
    // The temp copy multer wrote; the stored copy is in report storage now
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
  }
};

export const orderReview = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab request not found" });
    const { decision, note, reportId } = req.body;
    if (reportId && !validId(reportId)) return res.json({ success: false, message: "Please open the report again" });
    const order = await lab.reviewReport({ actor: req.actor, io: io(req), id: req.params.id, decision, note, reportId });
    res.json({ success: true, message: req.body.decision === "approve" ? "Report approved" : "Returned to the lab", order });
  } catch (error) {
    fail(res, error);
  }
};

export const orderCancel = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab request not found" });
    const order = await lab.cancelOrder({ actor: req.actor, io: io(req), id: req.params.id, note: req.body.note });
    res.json({ success: true, message: "Request cancelled", order });
  } catch (error) {
    fail(res, error);
  }
};

// --- Report files ---
// Step 1 (logged in): get a link valid for 10 minutes, for one file of one order.
// Step 2 (the link): stream the file. The link works in a new tab or an <iframe>,
// where the browser can't send our login header.

export const reportLink = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.json({ success: false, message: "Lab request not found" });
    const order = await lab.getOrder(req.actor, req.params.id);
    const report = req.params.reportId
      ? order.reports.find((r) => String(r._id) === req.params.reportId)
      : order.reports[order.reports.length - 1];
    if (!report) return res.json({ success: false, message: "No report uploaded yet" });
    const token = jwt.sign(
      { purpose: "lab-report", order: String(order._id), report: String(report._id) },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    res.json({ success: true, url: `/api/lab/files/${token}`, fileName: report.fileName, mimeType: report.mimeType });
  } catch (error) {
    fail(res, error);
  }
};

export const reportFile = async (req, res) => {
  let claims;
  try {
    claims = jwt.verify(req.params.token, process.env.JWT_SECRET);
    if (claims.purpose !== "lab-report") throw new Error("wrong purpose");
  } catch {
    return res.status(403).send("This link has expired. Open the report again from the system.");
  }
  try {
    const order = await labOrderModel.findById(claims.order).select("reports orderNumber").lean();
    const report = order?.reports.find((r) => String(r._id) === claims.report);
    if (!report) return res.status(404).send("Report not found");
    const stream = await openReport(report);
    const safeName = String(report.fileName || `L-${order.orderNumber}`).replace(/[^\w.\- ]/g, "_");
    res.set({
      "Content-Type": report.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    // pipeline also stops reading the file if the browser closes the tab
    pipeline(stream, res, (error) => {
      if (error && error.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error("Report stream failed:", error.message);
    });
  } catch (error) {
    console.error("Report open failed:", error.message);
    res.status(500).send("Could not open the report");
  }
};

export const storageInfo = (req, res) => res.json({ success: true, storage: reportStorageName() });
