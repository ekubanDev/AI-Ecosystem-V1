import { logger } from "../utils/logger.js";

/** Logs path only (never the query string: it can carry verification/reset tokens). */
export const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info("request", {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1000000n),
      userId: req.user?.id,
    });
  });
  next();
};
