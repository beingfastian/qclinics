import mongoose from "mongoose";

// Small, short-lived state for the WhatsApp bot. MongoDB deletes each record at expiresAt.

// Incoming messages already handled (Kapso/Twilio may deliver one twice): _id is the
// provider's message id. Kept 7 days.
const inboundSchema = new mongoose.Schema(
  { _id: { type: String }, expiresAt: { type: Date, required: true } },
  { versionKey: false }
);
inboundSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const whatsappInboundModel =
  mongoose.models.whatsappInbound || mongoose.model("whatsappInbound", inboundSchema);

// The numbered list a phone was sent after "CANCEL", so "CANCEL 2" cancels exactly the
// appointment shown as 2 (not whatever is second by then). _id is the phone. 30 minutes.
const cancelPromptSchema = new mongoose.Schema(
  { _id: { type: String }, appointmentIds: { type: [String], default: [] }, expiresAt: { type: Date, required: true } },
  { versionKey: false }
);
cancelPromptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const whatsappCancelPromptModel =
  mongoose.models.whatsappCancelPrompt || mongoose.model("whatsappCancelPrompt", cancelPromptSchema);
