// Creates (or repairs) the initial OWNER account. Usage:
//   SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD='...' npm run seed
// No default credentials are shipped; the password is read from the environment and never logged.
import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../config/db.js";
import { getConfig } from "../config/env.js";
import { User } from "../models/index.js";
import { audit } from "../services/auditService.js";

const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_OWNER_PASSWORD;
const name = process.env.SEED_OWNER_NAME?.trim() || "Owner";

if (!email || !password) {
  console.error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD.");
  process.exit(1);
}
if (password.length < 10 || Buffer.byteLength(password) > 72) {
  console.error("SEED_OWNER_PASSWORD must be 10-72 bytes.");
  process.exit(1);
}

const config = getConfig();
await connectDb(config);
try {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  const existing = await User.findOne({ email });
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { name, passwordHash, role: "OWNER", isEmailVerified: true, isActive: true }, $inc: { refreshTokenVersion: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  await audit({
    actor: { type: "SYSTEM" }, action: existing ? "USER_ROLE_CHANGED" : "USER_REGISTERED", resourceType: "User", resourceId: user._id,
    metadata: { via: "seed script", role: "OWNER" },
  });
  console.log(`${existing ? "Updated" : "Created"} OWNER ${email}`);
} finally {
  await disconnectDb();
}
