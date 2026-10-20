// The Express app on its own, without starting a server. Used two ways:
//   - server.js starts it as a normal always-on server (Railway, Render, local),
//     adding live updates (Socket.IO) and the reminder timer
//   - api/index.js exports it as a Vercel function (no live updates; reminders
//     run from a Vercel cron calling /api/cron/reminders)
import express from "express";
import cors from "cors";
import "dotenv/config";
import connectDB from "./config/mongodb.js";
import mongoose from "mongoose";
import { runMigrations } from "./config/migrations.js";
import connectCloudinary from "./config/cloudinary.js";
import adminRouter from "./routes/adminRoute.js";
import doctorRouter from "./routes/doctorRoute.js";
import whatsappRouter from "./routes/whatsappRoute.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import queueRouter from "./routes/queueRoute.js";
import labRouter from "./routes/labRoute.js";
import billingRouter from "./routes/billingRoute.js";
import { testEmailConnection } from "./config/emailService.js";
import { runReminderCheck } from "./jobs/reminders.js";

export const onVercel = Boolean(process.env.VERCEL);

// Fail fast with a clear message if required configuration is missing
const requiredEnv = ["MONGODB_URI", "JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  console.error("Copy backend/.env.example to backend/.env and fill them in.");
  process.exit(1);
}

// Allowed frontend origins, e.g. "https://site.vercel.app,https://admin.vercel.app".
// When unset (local development) every origin is allowed.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const corsOptions = { origin: allowedOrigins.length ? allowedOrigins : "*" };

const app = express();
app.set("trust proxy", 1); // correct protocol/host behind Render/Railway/Vercel proxies

// Live updates: server.js replaces this with the real Socket.IO server. Without one
// (Vercel), sends do nothing and screens pick changes up on their next refresh.
const noLiveUpdates = { to: () => noLiveUpdates, emit: () => false };
app.set("io", noLiveUpdates);

mongoose.connection.once("connected", () => runMigrations());
connectDB();
connectCloudinary();
// On Vercel every cold start would log in to the mail server; it's checked on first send instead
if (!onVercel) testEmailConnection();

// Middlewares
app.use(cors(corsOptions));
// Keep the raw body: webhook signatures (Kapso) are computed over the exact bytes
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Api Endpoints
app.use("/api/admin", adminRouter);
app.use("/api/doctor", doctorRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/notifications", notificationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/queue", queueRouter);
app.use("/api/lab", labRouter);
app.use("/api/billing", billingRouter);

// Reminder check for hosts without a background timer (Vercel cron). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; nothing runs without a matching secret.
app.get("/api/cron/reminders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (process.env.REMINDERS_ENABLED === "false") return res.json({ success: true, sent: 0, message: "Reminders are turned off" });
  try {
    res.json({ success: true, sent: await runReminderCheck() });
  } catch (error) {
    console.error("Reminder check failed:", error.message);
    res.status(500).json({ success: false, message: "Reminder check failed" });
  }
});

app.get("/", (req, res) => {
  res.status(200).send("API Working");
});

// Errors thrown by middleware (e.g. rejected uploads) as JSON instead of HTML
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ success: false, message: err.message || "Request failed" });
});

export default app;
