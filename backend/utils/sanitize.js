import { AppError } from "./errors.js";

/**
 * Rejects Mongo operator injection: any object key starting with "$" or containing "."
 * anywhere in a request payload.
 */
export const assertNoOperators = (value, path = "") => {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoOperators(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("$") || k.includes(".")) {
        throw new AppError("VALIDATION_ERROR", "Request contains disallowed keys.", {
          details: [{ path: path ? `${path}.${k}` : k, message: "Keys may not start with '$' or contain '.'" }],
        });
      }
      assertNoOperators(v, path ? `${path}.${k}` : k);
    }
  }
};
