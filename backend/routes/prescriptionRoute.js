import express from "express";
import { z } from "zod";
import mongoose from "mongoose";
import authRoles from "../middleware/authRoles.js";
import { validate } from "../lib/validate.js";
import * as rx from "../services/prescriptionService.js";

// Prescriptions. Doctors write and cancel their own; reception and the admin can
// look them up (and print them again). Medicine search goes to the hospital
// pharmacy's list when there is one.
const prescriptionRouter = express.Router();

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "Not found");
const text = (max) => z.string().trim().max(max);
const createSchema = z
  .object({
    appointmentId: id.optional(),
    queueTokenId: id.optional(),
    items: z
      .array(
        z.object({
          productId: id.optional(),
          name: z.string().trim().min(1, "Enter the medicine").max(120),
          strength: text(40).default(""),
          form: text(30).default(""),
          dose: text(40).default(""),
          days: z.number().int().min(1).max(365).optional(),
          qtyUnits: z.number().int().min(1).max(10000).optional(),
          instructions: text(200).default(""),
        })
      )
      .min(1, "Add at least one medicine")
      .max(30),
    note: text(1000).default(""),
  })
  .refine((v) => v.appointmentId || v.queueTokenId, "Please choose the patient");
const listSchema = z.object({
  appointmentId: id.optional(),
  userId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(100).optional(),
});
const idParams = z.object({ id });

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req)) });
  } catch (error) {
    if (error instanceof rx.RxError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Prescription error:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

prescriptionRouter.get(
  "/medicines",
  authRoles("doctor"),
  validate(z.object({ q: text(60).default("") }), "query"),
  handle(async (req) => ({ medicines: await rx.medicineSearch(req.validatedQuery.q) }))
);
prescriptionRouter.post(
  "/",
  authRoles("doctor"),
  validate(createSchema),
  handle(async (req) => {
    const prescription = await rx.createPrescription({ actor: req.actor, ...req.body });
    return {
      prescription,
      message: prescription.sentToPharmacy ? `Prescription Rx-${prescription.rxNo} sent to the pharmacy` : `Prescription Rx-${prescription.rxNo} saved`,
    };
  })
);
prescriptionRouter.get("/", authRoles("doctor", "admin", "reception"), validate(listSchema, "query"), handle(async (req) => rx.listPrescriptions(req.validatedQuery, req.actor)));
prescriptionRouter.get("/:id", authRoles("doctor", "admin", "reception"), validate(idParams, "params"), handle(async (req) => ({ prescription: await rx.getPrescription(req.params.id, req.actor) })));
prescriptionRouter.post("/:id/send", authRoles("doctor"), validate(idParams, "params"), handle(async (req) => ({ prescription: await rx.resend(req.params.id, req.actor), message: "Sent to the pharmacy" })));
prescriptionRouter.post("/:id/cancel", authRoles("doctor"), validate(idParams, "params"), handle(async (req) => ({ prescription: await rx.cancelPrescription(req.params.id, req.actor), message: "Prescription cancelled" })));

export default prescriptionRouter;
