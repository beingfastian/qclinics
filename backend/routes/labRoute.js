import express from "express";
import authRoles from "../middleware/authRoles.js";
import authAdmin from "../middleware/authAdmin.js";
import reportUpload from "../middleware/reportUpload.js";
import * as c from "../controllers/labController.js";

const labRouter = express.Router();

// Public
labRouter.get("/status", c.status);
labRouter.get("/files/:token", c.requireLabEnabled, c.reportFile); // short-lived signed link

labRouter.use(c.requireLabEnabled);
labRouter.post("/login", c.login);
labRouter.get("/me", authRoles("lab"), c.me);

// Lab staff accounts: admin only
labRouter.get("/staff", authAdmin, c.staffList);
labRouter.post("/staff", authAdmin, c.staffCreate);
labRouter.put("/staff/:id", authAdmin, c.staffUpdate);

// Test list: everyone reads; lab and admin edit
labRouter.get("/tests", authRoles("admin", "reception", "doctor", "lab"), c.testList);
labRouter.post("/tests", authRoles("admin", "lab"), c.testCreate);
labRouter.put("/tests/:id", authRoles("admin", "lab"), c.testUpdate);
labRouter.post("/tests/add-common", authRoles("admin", "lab"), c.testAddCommon);

// Orders. Who may do what is checked again in services/labService.js
labRouter.post("/orders", authRoles("doctor"), c.orderCreate);
labRouter.get("/orders", authRoles("admin", "reception", "doctor", "lab"), c.orderList);
labRouter.get("/orders/counts", authRoles("admin", "reception", "doctor", "lab"), c.orderCounts);
labRouter.get("/orders/:id", authRoles("admin", "reception", "doctor", "lab"), c.orderGet);
labRouter.post("/orders/:id/report", authRoles("lab"), reportUpload.single("report"), c.orderUpload);
labRouter.post("/orders/:id/review", authRoles("doctor"), c.orderReview);
labRouter.post("/orders/:id/cancel", authRoles("admin", "doctor"), c.orderCancel);
labRouter.get("/orders/:id/report-link", authRoles("admin", "reception", "doctor", "lab"), c.reportLink);
labRouter.get("/orders/:id/report-link/:reportId", authRoles("admin", "reception", "doctor", "lab"), c.reportLink);
labRouter.get("/storage", authRoles("admin", "lab"), c.storageInfo);

export default labRouter;
