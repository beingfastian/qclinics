// Work that finishes after the response (WhatsApp/email sends). On an always-on
// server it simply runs. On Vercel the function is frozen once it has replied, so
// the work is handed to waitUntil, which keeps the function alive until it's done.
import { waitUntil } from "@vercel/functions";

export const onVercel = Boolean(process.env.VERCEL);

export const background = (promise) => {
  if (onVercel) waitUntil(promise);
  return promise;
};
