// The home page and reports. Who may see what (permissions.js):
//   sell         the dashboard (their shift, held bills, stock alerts)
//   viewReports  today's takings on the dashboard, sales and item reports
//   viewProfit   cost, profit and stock value (left out for everyone else)
import { validate } from "../../../lib/validate.js";
import { handle } from "../http.js";
import { authPharmacy } from "../auth.js";
import * as reports from "../services/reportService.js";
import { reportRangeSchema, itemsReportSchema } from "../validation.js";

const actorRef = (req) => ({ role: req.actor.role, ...(req.actor.id && { id: req.actor.id }), name: req.actor.name });

export const mountReportRoutes = (router) => {
  router.get("/dashboard", authPharmacy("sell"), handle(async (req) => ({ dashboard: await reports.dashboard(actorRef(req)) })));
  router.get("/reports/summary", authPharmacy("viewReports"), validate(reportRangeSchema, "query"), handle(async (req) => reports.summaryReport(req.validatedQuery, actorRef(req))));
  router.get("/reports/items", authPharmacy("viewReports"), validate(itemsReportSchema, "query"), handle(async (req) => reports.itemsReport(req.validatedQuery, actorRef(req))));
};
