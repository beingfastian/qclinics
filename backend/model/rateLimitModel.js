import mongoose from "mongoose";

// Request counters for rate limiting (middleware/rateLimit.js). Kept in the database,
// not in memory, because on Vercel every request may run in a different instance.
// One document per key and time window: _id "<limiter>:<who>:<window start ms>".
const rateLimitSchema = new mongoose.Schema(
  {
    _id: { type: String },
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

// MongoDB deletes a window's counter once the window is over
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const rateLimitModel = mongoose.models.rateLimit || mongoose.model("rateLimit", rateLimitSchema);
export default rateLimitModel;
