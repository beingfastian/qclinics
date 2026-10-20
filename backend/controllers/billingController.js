import * as billing from "../services/billingService.js";

// Errors staff can act on are shown; anything else is logged and kept generic
const fail = (res, error) => {
  const safe = error instanceof billing.BillingError;
  if (!safe) console.error("Billing error:", error);
  res.json({
    success: false,
    message: safe ? error.message : "Something went wrong. Please try again.",
    ...(safe && error.code && { code: error.code }),
    ...(safe && error.extra?.expected !== undefined && { expected: error.extra.expected }),
    ...(safe && error.extra?.payment && { payment: error.extra.payment }),
  });
};

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req)) });
  } catch (error) {
    fail(res, error);
  }
};

// Who is at the counter: the owner, or reception plus the name picked on this
// computer (sent by the screen; the shared login can't tell people apart)
const byOf = (req) => ({
  role: req.desk.role,
  name: String(req.body?.staffName || req.query?.staffName || "").trim() || (req.desk.role === "admin" ? "Owner" : "Reception"),
});

export const requireBillingEnabled = (req, res, next) =>
  billing.billingEnabled() ? next() : res.status(404).json({ success: false, message: "Billing is turned off" });

export const status = (req, res) => res.json({ success: true, enabled: billing.billingEnabled() });

export const settings = handle(async () => ({ settings: await billing.getSettings() }));
export const saveSettings = handle(async (req) => ({ settings: await billing.saveSettings(req.body || {}) }));

export const due = handle(async () => ({ due: await billing.dueList() }));
export const dueFor = handle(async (req) => ({
  due: await billing.dueFor({ appointmentId: req.query.appointmentId, labOrderId: req.query.labOrderId }),
}));

export const collect = handle(async (req) => {
  const { payment, repeated } = await billing.collect(req.body || {}, byOf(req));
  return { payment, repeated, message: `Receipt ${payment.receiptNo} saved` };
});

export const receipts = handle(async (req) => {
  // Reception sees today's receipts (to reprint one); the owner can pick dates
  const owner = req.desk.role === "admin";
  return {
    receipts: await billing.receipts({
      from: owner ? req.query.from : undefined,
      to: owner ? req.query.to : undefined,
      counterId: req.query.counterId,
      q: req.query.q,
    }),
  };
});

export const refund = handle(async (req) => {
  const result = await billing.refund({ ...req.body, paymentId: req.params.id }, byOf(req));
  return { ...result, message: `Rs ${result.refund.amount} refunded` };
});

export const closePreview = handle(async (req) => ({ preview: await billing.closePreview(req.query.counterId) }));
export const close = handle(async (req) => ({ close: await billing.closeCounter(req.body || {}, byOf(req)), message: "Counter closed" }));
export const verify = handle(async (req) => ({ close: await billing.verifyClose(req.params.id, byOf(req)), message: "Verified" }));

export const summary = handle(async (req) => ({ summary: await billing.summary({ from: req.query.from, to: req.query.to }) }));
