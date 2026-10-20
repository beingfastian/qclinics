import express from "express";
import authDesk from "../middleware/authDesk.js";
import authAdmin from "../middleware/authAdmin.js";
import * as c from "../controllers/billingController.js";

const billingRouter = express.Router();

// Public: is billing turned on for this hospital?
billingRouter.get("/status", c.status);

billingRouter.use(c.requireBillingEnabled);

// Front desk (owner or the shared reception login)
billingRouter.get("/settings", authDesk, c.settings);
billingRouter.get("/due", authDesk, c.due);
billingRouter.get("/due-for", authDesk, c.dueFor);
billingRouter.post("/collect", authDesk, c.collect);
billingRouter.get("/receipts", authDesk, c.receipts);
billingRouter.get("/close-preview", authDesk, c.closePreview);
billingRouter.post("/close", authDesk, c.close);

// Owner only (authAdmin checks it's the owner; authDesk then sets req.desk for the record)
billingRouter.put("/settings", authAdmin, authDesk, c.saveSettings);
billingRouter.post("/payments/:id/refund", authAdmin, authDesk, c.refund);
billingRouter.post("/closes/:id/verify", authAdmin, authDesk, c.verify);
billingRouter.get("/summary", authAdmin, authDesk, c.summary);

export default billingRouter;
