export const HTTP_STATUS = {
  VALIDATION_ERROR: 422,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  AGENT_ERROR: 502,
  AGENT_TIMEOUT: 504,
  EXTERNAL_SERVICE_ERROR: 502,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  /**
   * @param {keyof typeof HTTP_STATUS} code
   * @param {string} message
   * @param {{details?: any[], retryable?: boolean, status?: number, cause?: Error}} [opts]
   */
  constructor(code, message, { details = [], retryable = false, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? HTTP_STATUS[code] ?? 500;
    this.details = details;
    this.retryable = retryable;
  }
}

export const notFound = (what = "Resource") => new AppError("RESOURCE_NOT_FOUND", `${what} not found.`);
export const conflict = (message) => new AppError("RESOURCE_CONFLICT", message);
export const forbidden = (message = "You do not have permission to perform this action.") => new AppError("FORBIDDEN", message);
export const invalidTransition = (from, to) =>
  new AppError("INVALID_STATE_TRANSITION", `Cannot move from ${from} to ${to}.`, { details: [{ from, to }] });

/** Errors worth retrying: flagged explicitly, or common transient network failures. */
export const isRetryable = (err) => {
  if (!err) return false;
  if (err.retryable === true) return true;
  return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(err.code);
};
