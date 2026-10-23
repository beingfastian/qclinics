// The counter. Who may do what (permissions.js):
//   sell               own shift, sales, held bills, look up a bill
//   returnWithBill     returns against a bill (any counter's)
//   returnWithoutBill  returns without a bill (managers)
//   viewReports        every shift and sale, not only one's own
import { validate } from "../../../lib/validate.js";
import { handle } from "../http.js";
import { authPharmacy } from "../auth.js";
import * as shifts from "../services/shiftService.js";
import * as sales from "../services/saleService.js";
import * as returns from "../services/returnService.js";
import {
  idParam,
  openShiftSchema,
  closeShiftSchema,
  shiftListSchema,
  createSaleSchema,
  saleListSchema,
  saleNoParam,
  holdBillSchema,
  createReturnSchema,
} from "../validation.js";

const actorRef = (req) => ({ role: req.actor.role, ...(req.actor.id && { id: req.actor.id }), name: req.actor.name });

export const mountSalesRoutes = (router) => {
  // --- Shifts ---
  router.get("/shifts/current", authPharmacy("sell"), handle(async (req) => ({ shift: await shifts.currentShift(actorRef(req)) })));
  router.post(
    "/shifts/open",
    authPharmacy("sell"),
    validate(openShiftSchema),
    handle(async (req) => {
      const { shift, repeated } = await shifts.openShift(req.body, actorRef(req));
      return { shift, repeated, message: repeated ? "Your shift is already open" : "Shift opened" };
    })
  );
  router.post("/shifts/close", authPharmacy("sell"), validate(closeShiftSchema), handle(async (req) => ({ shift: await shifts.closeShift(req.body, actorRef(req)), message: "Shift closed" })));
  router.get("/shifts", authPharmacy("viewReports"), validate(shiftListSchema, "query"), handle(async (req) => shifts.listShifts(req.validatedQuery, actorRef(req))));
  router.get("/shifts/:id", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => ({ shift: await shifts.getShift(req.params.id, actorRef(req)) })));

  // --- Sales ---
  router.post(
    "/sales",
    authPharmacy("sell"),
    validate(createSaleSchema),
    handle(async (req) => {
      const { sale, repeated } = await sales.createSale(req.body, actorRef(req));
      return { sale, repeated, message: `Bill ${sale.saleNo} saved` };
    })
  );
  router.get(
    "/sales",
    authPharmacy("sell"),
    validate(saleListSchema, "query"),
    handle(async (req) => {
      const own = await shifts.openShiftOf(actorRef(req));
      return sales.listSales(req.validatedQuery, actorRef(req), own && String(own._id));
    })
  );
  router.get("/sales/no/:no", authPharmacy("sell"), validate(saleNoParam, "params"), handle(async (req) => ({ sale: await sales.saleByNumber(req.params.no, actorRef(req)) })));
  router.get("/sales/:id", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => ({ sale: await sales.getSale(req.params.id, actorRef(req)) })));

  // --- Held bills ---
  router.get("/held", authPharmacy("sell"), handle(async () => ({ held: await sales.listHeld() })));
  router.post("/held", authPharmacy("sell"), validate(holdBillSchema), handle(async (req) => ({ held: await sales.holdBill(req.body, actorRef(req)), message: "Bill held" })));
  router.post("/held/:id/take", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => ({ held: await sales.takeHeld(req.params.id) })));

  // --- Returns ---
  router.post(
    "/returns",
    authPharmacy("returnWithBill"),
    validate(createReturnSchema),
    handle(async (req) => {
      const { return: saved, repeated } = await returns.createReturn(req.body, actorRef(req));
      return { return: saved, repeated, message: `Return ${saved.returnNo} saved. Refund Rs ${(saved.totalRefundPaisa / 100).toLocaleString("en-PK")}` };
    })
  );
  router.get("/returns/:id", authPharmacy("returnWithBill"), validate(idParam, "params"), handle(async (req) => ({ return: await returns.getReturn(req.params.id, actorRef(req)) })));
};
