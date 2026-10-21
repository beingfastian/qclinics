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
  // Reception is recorded as the admin role (what visit and token history accept), tagged "reception"
  req.actor =
    req.recipientType === "doctor"
      ? { role: "doctor", id: req.recipient }
      : { role: "admin", ...(req.isReception && { id: "reception" }) };
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

// Public: no login, no patient names. Waiting-room screens (every 7 s) and patients'
// phones (every 15 s) poll these, so they are cached for a few seconds:
//   - at Vercel's edge (s-maxage): most polls never reach the function
//   - here, for the board: screens asking at the same moment share one database read
// A few seconds' delay is fine for a queue screen.
const PUBLIC_CACHE = "public, max-age=5, s-maxage=5, stale-while-revalidate=10";
const BOARD_TTL_MS = 3000;
let boardCache = { at: 0, data: null, pending: null };
export const cachedPublicBoard = () => {
  if (boardCache.data && Date.now() - boardCache.at < BOARD_TTL_MS) return Promise.resolve(boardCache.data);
  if (!boardCache.pending) {
    boardCache.pending = publicBoard()
      .then((data) => {
        boardCache = { at: Date.now(), data, pending: null };
        return data;
      })
      .catch((error) => {
        boardCache.pending = null;
        throw error;
      });
  }
  return boardCache.pending;
};

export const board = async (req, res) => {
  try {
    const data = await cachedPublicBoard();
    res.set("Cache-Control", PUBLIC_CACHE).json({ success: true, board: data });
  } catch (error) {
    res.set("Cache-Control", "no-store"); // never cache a failure
    fail(res, error);
  }
};

export const token = async (req, res) => {
  try {
    const data = await publicToken(req.params.publicId);
    if (!data) return res.set("Cache-Control", "no-store").status(404).json({ success: false, message: "Token not found" });
    res.set("Cache-Control", PUBLIC_CACHE).json({ success: true, token: data });
  } catch (error) {
    res.set("Cache-Control", "no-store"); // never cache a failure
    fail(res, error);
  }
};
