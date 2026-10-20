// Limits on sign-in and password-reset requests, so passwords and reset codes can't
// be guessed by sending thousands of requests.
//
// The counters live in MongoDB (model/rateLimitModel.js), not in memory: on Vercel
// each request may run in a different instance, and an in-memory count would start
// from zero in each one. Each request is one atomic $inc on its window's counter.
//
// Two limits per route, both must pass:
//   - per IP address: one computer trying many accounts
//   - per account (the email typed): many computers trying one account
// Staff at one clinic share one internet address, so the per-IP limits leave room
// for a whole front desk signing in at shift change.
//
// Settings (backend .env), all optional:
//   RATE_LIMIT_ENABLED=false     turns the limits off
//   RATE_LIMIT_AUTH_PER_IP=30    sign-in / reset requests per IP per 15 minutes
//   RATE_LIMIT_AUTH_PER_ACCOUNT=10  per email per 15 minutes
import rateLimit from "express-rate-limit";
import rateLimitModel from "../model/rateLimitModel.js";

const WINDOW_MS = 15 * 60 * 1000;
const setting = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// express-rate-limit store backed by MongoDB (fixed windows)
export class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false; // shared by every instance
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  window(key) {
    const start = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    return { id: `${this.prefix}:${key}:${start}`, resetTime: new Date(start + this.windowMs) };
  }

  async increment(key) {
    const { id, resetTime } = this.window(key);
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await rateLimitModel.findOneAndUpdate(
          { _id: id },
          { $inc: { hits: 1 }, $setOnInsert: { expiresAt: resetTime } },
          { upsert: true, new: true, lean: true }
        );
        return { totalHits: doc.hits, resetTime };
      } catch (error) {
        // Two first requests of a window at the same moment: the second upsert retries
        if (error?.code === 11000 && attempt < 2) continue;
        // The database being unreachable must not lock everyone out of signing in
        // (sign-in would fail anyway); the request goes through and the error is logged
        console.error("Rate limit counter failed:", error.message);
        return { totalHits: 0, resetTime };
      }
    }
  }

  async decrement(key) {
    await rateLimitModel.updateOne({ _id: this.window(key).id }, { $inc: { hits: -1 } }).catch(() => {});
  }

  async resetKey(key) {
    await rateLimitModel.deleteMany({ _id: { $regex: `^${this.prefix}:${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } }).catch(() => {});
  }
}

const enabled = () => process.env.RATE_LIMIT_ENABLED !== "false";

const tooMany = (req, res, next, options) => {
  const minutes = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 60000));
  res.status(options.statusCode).json({
    success: false,
    code: "rate_limited",
    message: `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
  });
};

const limiter = (name, limit, keyGenerator) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore(name),
    skip: () => !enabled(),
    handler: tooMany,
    ...(keyGenerator && { keyGenerator }),
  });

// The email typed in the form, so one account can't be attacked from many addresses
const accountKey = (req) => String(req.body?.email || "").trim().toLowerCase() || `ip:${req.ip}`;

// Sign-in (every login endpoint shares the same counters)
export const loginLimits = [
  limiter("login-ip", setting("RATE_LIMIT_AUTH_PER_IP", 30)),
  limiter("login-account", setting("RATE_LIMIT_AUTH_PER_ACCOUNT", 10), accountKey),
];

// Forgot password, verify code, set new password
export const passwordResetLimits = [
  limiter("reset-ip", setting("RATE_LIMIT_AUTH_PER_IP", 30)),
  limiter("reset-account", setting("RATE_LIMIT_AUTH_PER_ACCOUNT", 10), accountKey),
];
