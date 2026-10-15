import mongoose from "mongoose";
import {
  QueueError,
  searchPatients,
  issueToken,
  callNext,
  tokenAction,
  setPaused,
  staffView,
  publicBoard,
  publicToken,
  trackUrl,
} from "../services/queueService.js";
import { AppointmentError } from "../services/appointmentService.js";

// Errors staff can act on are shown; anything else is logged and kept generic
const fail = (res, error) => {
  const safe = error instanceof QueueError || error instanceof AppointmentError;
  if (!safe) console.error("Queue error:", error);
  res.json({ success: false, message: safe ? error.message : "Something went wrong. Please try again." });
};

// Which doctor's queue: a doctor always gets their own; admin/reception chooses one.
// Runs after authStaff, which sets req.recipientType / req.recipient.
export const queueDoctor = (req, res, next) => {
  // Only reception (admin login) and doctors run queues; lab staff pass authStaff
  // for notifications but must not reach these routes
  if (req.recipientType !== "admin" && req.recipientType !== "doctor") {
    return res.status(403).json({ success: false, message: "You don't have access to this" });
  }
  const docId = req.recipientType === "doctor" ? req.recipient : req.body?.docId || req.query?.docId;
  if (!docId || !mongoose.isValidObjectId(docId)) {
    return res.json({ success: false, message: "Please select a doctor" });
  }
  req.queueDocId = String(docId);
  req.actor = req.recipientType === "doctor" ? { role: "doctor", id: req.recipient } : { role: "admin" };
  next();
};

export const getQueue = async (req, res) => {
  try {
    res.json({ success: true, queue: await staffView(req.queueDocId) });
  } catch (error) {
    fail(res, error);
  }
};

export const issue = async (req, res) => {
  try {
    const { appointmentId, userId, patientName, phone, cnic, notify, language, fee, urgent, age, gender } = req.body;
    if ((appointmentId && !mongoose.isValidObjectId(appointmentId)) || (userId && !mongoose.isValidObjectId(userId))) {
      return res.json({ success: false, message: "Patient not found. Please search again." });
    }
    const { token, existing } = await issueToken({
      docId: req.queueDocId,
      appointmentId,
      userId,
      patientName,
      phone,
      cnic,
      notify,
      language,
      fee,
      urgent,
      age,
      gender,
      actor: req.actor,
    });
    res.json({
      success: true,
      message: existing ? `Already checked in: token ${token.number}` : `Token ${token.number} issued`,
      token: { ...token.toObject(), trackUrl: trackUrl(token.publicId) },
      existing,
    });
  } catch (error) {
    fail(res, error);
  }
};

export const call = async (req, res) => {
  try {
    const { tokenId, expectedCurrentId } = req.body;
    if (tokenId && !mongoose.isValidObjectId(tokenId)) return res.json({ success: false, message: "Token not found" });
    const token = await callNext(req.queueDocId, req.actor, tokenId, expectedCurrentId);
    res.json({
      success: true,
      message: token ? `Token ${token.number} called` : "No one is waiting",
      token,
    });
  } catch (error) {
    fail(res, error);
  }
};

export const action = async (req, res) => {
  try {
    const { tokenId, action: name } = req.body;
    if (!mongoose.isValidObjectId(tokenId)) return res.json({ success: false, message: "Token not found" });
    const token = await tokenAction(req.queueDocId, tokenId, name, req.actor);
    res.json({ success: true, token });
  } catch (error) {
    fail(res, error);
  }
};

export const pause = async (req, res) => {
  try {
    await setPaused(req.queueDocId, req.body.paused, req.body.note);
    res.json({ success: true, message: req.body.paused ? "Queue paused" : "Queue resumed" });
  } catch (error) {
    fail(res, error);
  }
};

// Reception / doctor: find an existing patient before giving a walk-in token
export const patients = async (req, res) => {
  if (req.recipientType !== "admin" && req.recipientType !== "doctor") {
    return res.status(403).json({ success: false, message: "You don't have access to this" });
  }
  try {
    res.json({ success: true, patients: await searchPatients(req.query.q) });
  } catch (error) {
    fail(res, error);
  }
};

// Public: no login, no patient names. Not cached, so screens always show the latest.
export const board = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, board: await publicBoard() });
  } catch (error) {
    fail(res, error);
  }
};

export const token = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await publicToken(req.params.publicId);
    if (!data) return res.status(404).json({ success: false, message: "Token not found" });
    res.json({ success: true, token: data });
  } catch (error) {
    fail(res, error);
  }
};
