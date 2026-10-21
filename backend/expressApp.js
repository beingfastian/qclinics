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
// A "*" inside an entry matches one part of an address, for Vercel preview
// deployments: "https://hmc-*-myteam.vercel.app". When unset (local development)
// every origin is allowed; in production that is logged as a warning.
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((origin) =>
      origin.includes("*")
        ? new RegExp(`^${origin.split("*").map(escapeRegex).join("[a-z0-9-]+")}$`, "i")
        : origin
    );
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);
if (!allowedOrigins.length && (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production")) {
  console.warn("WARNING: CORS_ORIGINS is not set, so any website can call this API from a browser. Set it to the staff app's address.");
}
// maxAge: browsers remember the CORS check ("may I call this API?") for 2 hours
// instead of sending an extra OPTIONS request before almost every call
export const corsOptions = { origin: allowedOrigins.length ? allowedOrigins : "*", maxAge: 7200 };

const app = express();
app.set("trust proxy", 1); // correct protocol/host behind Render/Railway/Vercel proxies

// Live updates: server.js replaces this with the real Socket.IO server. Without one
// (Vercel), sends do nothing and screens pick changes up on their next refresh.
const noLiveUpdates = { to: () => noLiveUpdates, emit: () => false };
app.set("io", noLiveUpdates);

mongoose.connection.once("connected", () => runMigrations());
// On an always-on server a database that can't be reached at start is fatal (the
// host restarts it). On Vercel the instance stays up and later requests retry.
connectDB().catch(() => {
  if (!onVercel) process.exit(1);
});
connectCloudinary();
// On Vercel every cold start would log in to the mail server; it's checked on first send instead
if (!onVercel) testEmailConnection();

// Middlewares
app.use(cors(corsOptions));
// Keep the raw body: webhook signatures (Kapso) are computed over the exact bytes
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Requests that need the database wait for it briefly (a new Vercel instance may
// still be connecting, or retrying after a failed first try). If it stays
// unreachable they get a clear 503 the staff app retries, never a crash.
// Requests that don't need it (health check, on/off status) never wait.
const DB_WAIT_MS = Number(process.env.DB_WAIT_MS) || 15000;
const NO_DATABASE = new Set(["/", "/api/live", "/api/billing/status", "/api/lab/status"]);
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState === 1 || NO_DATABASE.has(req.path)) return next();
  let timer;
  try {
    await Promise.race([
      connectDB(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_WAIT_MS);
      }),
    ]);
    next();
  } catch {
    res.set("Retry-After", "3").status(503).json({
      success: false,
      code: "db_unavailable",
      message: "The server is starting up. Please try again in a moment.",
    });
  } finally {
    clearTimeout(timer);
  }
});

// Whether live updates (Socket.IO) exist here: only on an always-on server, not on
// Vercel. The staff app asks once and, without them, refreshes by polling instead
// of trying to connect (which only produced 404s).
app.get("/api/live", (req, res) => res.json({ success: true, live: !onVercel }));

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
