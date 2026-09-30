import nodemailer from "nodemailer";
import { AppError } from "../utils/errors.js";

/**
 * Gmail SMTP transport (implicit TLS on 465) authenticated with an App Password.
 * `mailer` is injectable for tests; in production it is a real nodemailer transporter with bounded timeouts so a
 * slow or unreachable SMTP server cannot hang a request.
 */
export function createGmailTransport({ user, appPassword, from, mailer }) {
  const transporter =
    mailer ??
    nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: appPassword },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
  return {
    name: "gmail",
    async send(message) {
      try {
        // Gmail rewrites From to the authenticated account unless the address is a verified alias.
        await transporter.sendMail({ from: from ?? message.from ?? user, to: message.to, subject: message.subject, text: message.text });
      } catch (err) {
        throw new AppError("EXTERNAL_SERVICE_ERROR", `Email delivery failed: ${err.responseCode === 535 ? "Gmail rejected the credentials (use an App Password)" : err.message}`, { retryable: true, cause: err });
      }
    },
  };
}
