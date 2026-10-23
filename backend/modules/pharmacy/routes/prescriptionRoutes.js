// Prescriptions from the hospital's doctors (only in a hospital's pharmacy).
// Anyone at the counter (sell) works the queue: dispense at the counter, or close
// one the patient didn't buy.
import { validate } from "../../../lib/validate.js";
import { handle } from "../http.js";
import { authPharmacy } from "../auth.js";
import * as rx from "../services/prescriptionService.js";
import { idParam, rxListSchema, rxCloseSchema } from "../validation.js";

const actorRef = (req) => ({ role: req.actor.role, ...(req.actor.id && { id: req.actor.id }), name: req.actor.name });

export const mountPrescriptionRoutes = (router) => {
  router.get("/prescriptions", authPharmacy("sell"), validate(rxListSchema, "query"), handle(async (req) => rx.listPrescriptions(req.validatedQuery)));
  router.get("/prescriptions/count", authPharmacy("sell"), handle(async () => ({ open: await rx.openCount() })));
  router.get("/prescriptions/:id", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => ({ prescription: await rx.getPrescription(req.params.id) })));
  router.post(
    "/prescriptions/:id/close",
    authPharmacy("sell"),
    validate(idParam, "params"),
    validate(rxCloseSchema),
    handle(async (req) => ({ prescription: await rx.closePrescription(req.params.id, req.body, actorRef(req)), message: "Prescription closed" }))
  );
};
