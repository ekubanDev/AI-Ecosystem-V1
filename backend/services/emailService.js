import { logger } from "../utils/logger.js";

/** Default transport: logs the message. Swap in a real provider by passing `{ send(message) }` to createEmailService. */
export const consoleTransport = {
  async send(message) {
    logger.info("email (console transport — no provider configured)", { to: message.to, subject: message.subject, text: message.text });
  },
};

export function createEmailService({ config, transport = consoleTransport }) {
  const send = (to, subject, text) => transport.send({ from: config.EMAIL_FROM, to, subject, text });
  const link = (path, token) => `${config.clientUrl}${path}?token=${encodeURIComponent(token)}`;
  return {
    sendVerification: (user, token) =>
      send(user.email, "Verify your email", `Hi ${user.name},\n\nVerify your email: ${link("/verify-email", token)}\n\nThis link expires in 24 hours.`),
    sendPasswordReset: (user, token) =>
      send(user.email, "Reset your password", `Hi ${user.name},\n\nReset your password: ${link("/reset-password", token)}\n\nThis link expires in 1 hour. If you did not request it, ignore this email.`),
  };
}
