// Background sending of WhatsApp/email notifications, so API requests don't wait
// for Gmail or WhatsApp (1-3 seconds each). Requests add jobs and return at once.
//
// - At most NOTIFY_CONCURRENCY jobs run at a time (default 3), which also keeps
//   Gmail/WhatsApp from being flooded when many bookings arrive together.
// - Failed sends are retried after 10s and 60s, unless the error can't fix itself
//   (e.g. "not configured").
// - The outcome of each job is saved on the appointment (appointment.notifications).
//
// Jobs live in memory: if the server restarts with jobs still waiting, those are lost.
//
// On Vercel (no always-on server) each job runs at once under waitUntil, with one
// quick retry, because a function can't wait 10-60 seconds between attempts.
import appointmentModel from "../model/appointmentModel.js";
import { background, onVercel } from "../utils/background.js";

const MAX_CONCURRENT = Number(process.env.NOTIFY_CONCURRENCY ?? 3);
const RETRY_DELAYS_MS = [10_000, 60_000];
const PERMANENT_ERRORS = /not configured|No phone number/i;

const waiting = [];
let running = 0;

const record = async (job, status, error) => {
  // Optional hook for callers that keep their own log (e.g. queue tokens)
  try {
    await job.onDone?.(status, error);
  } catch (e) {
    console.error("Notification onDone failed:", e.message);
  }
  if (!job.appointmentId) return;
  try {
    await appointmentModel.updateOne(
      { _id: job.appointmentId },
      {
        $push: {
          notifications: {
            at: new Date(),
            channel: job.channel,
            recipient: job.recipient,
            kind: job.kind,
            status,
            ...(error && { error: String(error).slice(0, 300) }),
          },
        },
      }
    );
  } catch (e) {
    console.error("Could not record notification result:", e.message);
  }
};

const run = async (job) => {
  let result;
  try {
    result = await job.send();
  } catch (error) {
    result = { success: false, error: error.message };
  }

  if (result?.success) {
    await record(job, "sent");
    return;
  }

  const error = result?.error || "Unknown error";
  if (onVercel) {
    if (job.attempt === 0 && !PERMANENT_ERRORS.test(error)) {
      job.attempt = 1;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return run(job);
    }
    console.error(`Notification failed (${job.channel} to ${job.recipient}, ${job.kind}): ${error}`);
    await record(job, "failed", error);
    return;
  }
  const retryIn = RETRY_DELAYS_MS[job.attempt];
  if (retryIn !== undefined && !PERMANENT_ERRORS.test(error)) {
    job.attempt += 1;
    setTimeout(() => enqueue(job), retryIn).unref?.();
    return;
  }
  console.error(`Notification failed (${job.channel} to ${job.recipient}, ${job.kind}): ${error}`);
  await record(job, "failed", error);
};

const pump = () => {
  while (running < MAX_CONCURRENT && waiting.length) {
    const job = waiting.shift();
    running++;
    run(job).finally(() => {
      running--;
      pump();
    });
  }
};

const enqueue = (job) => {
  waiting.push(job);
  pump();
};

// Add a send to the queue. `send` must return { success, error? }.
// job: { appointmentId?, channel: "whatsapp" | "email", recipient: "patient" | "doctor", kind, send,
//        onDone?(status: "sent" | "failed", error?) }
export const queueNotification = (job) => {
  if (onVercel) {
    background(run({ attempt: 0, ...job }));
    return;
  }
  enqueue({ attempt: 0, ...job });
};

// For tests and monitoring
export const queueStats = () => ({ waiting: waiting.length, running });
