// Standalone worker process: `npm run worker` (set RUN_WORKER=false on the API instances when using this).
import { connectDb, disconnectDb } from "./config/db.js";
import { getConfig } from "./config/env.js";
import { createContainer } from "./container.js";
import { logger, setLogLevel } from "./utils/logger.js";

const config = getConfig();
setLogLevel(config.LOG_LEVEL);
await connectDb(config);
const { worker } = createContainer(config);
await worker.start();

const shutdown = async (signal) => {
  logger.info("worker shutting down", { signal });
  await worker.stop();
  await disconnectDb();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
