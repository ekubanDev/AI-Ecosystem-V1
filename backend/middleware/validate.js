import { AppError } from "../utils/errors.js";
import { assertNoOperators } from "../utils/sanitize.js";

export const zodDetails = (error) =>
  error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));

/**
 * validate({ body, query, params }) with zod schemas. Parsed values land on req.valid
 * (Express 5's req.query is read-only). Unknown keys are stripped, which also prevents mass assignment.
 */
export const validate = (schemas) => (req, _res, next) => {
  assertNoOperators(req.body, "body");
  assertNoOperators(req.query, "query");
  req.valid = req.valid ?? {};
  const details = [];
  for (const part of ["params", "query", "body"]) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) req.valid[part] = result.data;
    else details.push(...zodDetails(result.error).map((d) => ({ ...d, path: `${part}.${d.path}`.replace(/\.$/, "") })));
  }
  if (details.length) throw new AppError("VALIDATION_ERROR", "One or more fields are invalid.", { details });
  next();
};
