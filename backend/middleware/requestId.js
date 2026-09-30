import crypto from "node:crypto";

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestId = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.id = incoming && VALID.test(incoming) ? incoming : `req_${crypto.randomBytes(8).toString("hex")}`;
  res.setHeader("X-Request-ID", req.id);
  next();
};
