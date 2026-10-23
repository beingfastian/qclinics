// The pharmacy module: one self-contained part of the app, used in two ways
// (config/modules.js):
//   - a standalone pharmacy (APP_MODE=pharmacy)
//   - the pharmacy of a hospital (PHARMACY_ENABLED=true)
//
// Boundaries: the module keeps its own data (collections "pharmacy_*") and never
// reads or writes hospital collections; the hospital never touches the module's
// internals. Anything that crosses goes through the module's ports (added with the
// hospital integration: prescriptions in, dispensing status out).
import express from "express";
import { validate } from "../../lib/validate.js";
import { handle } from "./http.js";
import { authPharmacy, ownerOnly } from "./auth.js";
import { permissionsOf } from "./permissions.js";
import * as staff from "./services/staffService.js";
import { createStaffSchema, updateStaffSchema, idParam } from "./validation.js";
import { mountStockRoutes } from "./routes/stockRoutes.js";
import { mountSalesRoutes } from "./routes/salesRoutes.js";
import { mountReportRoutes } from "./routes/reportRoutes.js";

export const pharmacyRouter = () => {
  const router = express.Router();

  router.get("/status", (req, res) => res.json({ success: true, enabled: true }));

  // The signed-in pharmacy user and what they may do (the staff app shows screens by this)
  router.get(
    "/me",
    authPharmacy(),
    handle(async (req) => ({ user: { ...req.actor, permissions: permissionsOf(req.actor) } }))
  );

  // Staff accounts: owner only
  router.get("/staff", ownerOnly, handle(async () => ({ staff: await staff.listStaff() })));
  router.post(
    "/staff",
    ownerOnly,
    validate(createStaffSchema),
    handle(async (req) => ({ staff: await staff.createStaff(req.body), message: "Pharmacy account created" }))
  );
  router.put(
    "/staff/:id",
    ownerOnly,
    validate(idParam, "params"),
    validate(updateStaffSchema),
    handle(async (req) => ({ staff: await staff.updateStaff(req.params.id, req.body), message: "Pharmacy account updated" }))
  );

  // Items, suppliers, purchases, stock
  mountStockRoutes(router);

  // The counter: shifts, sales, held bills, returns
  mountSalesRoutes(router);

  // Dashboard and reports
  mountReportRoutes(router);

  return router;
};

// Shared sign-in (controllers/authController.js) checks pharmacy staff through this
export { checkLogin as checkPharmacyLogin } from "./services/staffService.js";
