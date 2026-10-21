// Errors and responses for the pharmacy module's API.
//
// Business rules throw PharmacyError with a message staff can act on and a proper
// HTTP status (400 bad input, 403 not allowed, 404 not found, 409 conflict). Anything
// else is logged on the server and answered with a generic message, so internal
// details never reach the browser.
export class PharmacyError extends Error {
  constructor(message, { status = 400, code, extra } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what) => new PharmacyError(`${what} not found`, { status: 404, code: "not_found" });

const sendError = (res, error) => {
  if (error instanceof PharmacyError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.code && { code: error.code }),
      ...(error.extra && { ...error.extra }),
    });
  }
  console.error("Pharmacy error:", error);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
};

// Wraps a handler: fn(req) returns the response fields; errors are answered as above
export const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, res)) });
  } catch (error) {
    sendError(res, error);
  }
};

export const deny = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code && { code }) });
