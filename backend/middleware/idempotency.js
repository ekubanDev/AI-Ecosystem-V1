import { IdempotencyKey } from "../models/index.js";
import { AppError } from "../utils/errors.js";
import { sha256 } from "../utils/text.js";

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Optional `Idempotency-Key` support for retry-sensitive POST endpoints.
 * Same key + same body replays the stored response; same key + different body is a conflict;
 * a concurrent duplicate while the first is in flight is a conflict. Only 2xx responses are stored; failures release the key.
 * Must run after `protect` and `validate` (keys are scoped per user and route).
 */
export const idempotent = async (req, res, next) => {
  const key = req.get("idempotency-key");
  if (!key) return next();
  if (!KEY_RE.test(key)) throw new AppError("VALIDATION_ERROR", "Idempotency-Key must be 8-128 chars: letters, digits, . _ : -");

  const scope = `${req.user.id}:${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
  const requestHash = sha256(JSON.stringify(req.body ?? {}));

  try {
    await IdempotencyKey.create({ key, scope, requestHash });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const existing = await IdempotencyKey.findOne({ key, scope });
    if (!existing) return next(); // expired between calls; treat as a fresh request
    if (existing.requestHash !== requestHash)
      throw new AppError("RESOURCE_CONFLICT", "Idempotency-Key was already used with a different request body.");
    if (existing.state !== "COMPLETED")
      throw new AppError("RESOURCE_CONFLICT", "A request with this Idempotency-Key is still in progress.");
    res.setHeader("Idempotent-Replayed", "true");
    return res.status(existing.responseStatus).json(existing.responseBody);
  }

  const json = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    // Only successful responses are replayable; anything else releases the key so the caller can retry.
    const persist =
      status >= 300
        ? IdempotencyKey.deleteOne({ key, scope })
        : IdempotencyKey.updateOne({ key, scope }, { $set: { state: "COMPLETED", responseStatus: status, responseBody: body } });
    persist.catch(() => {}).then(() => json(body));
    return res;
  };
  next();
};
