const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side checks for the public lead form. The server validates again; this only saves a round trip and gives per-field messages. */
export function validateLead(v) {
  const errors = {};
  if (!v.name?.trim()) errors.name = "Please enter your name.";
  if (!v.email?.trim()) errors.email = "Please enter your email address.";
  else if (!EMAIL.test(v.email.trim())) errors.email = "That email address does not look right.";
  if (!v.consent) errors.consent = "Please tick the box to agree before submitting.";
  return errors;
}

/** Bullets are edited as one per line. */
export const parseBullets = (text) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
