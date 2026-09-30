import { createApp } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { getConfig } from "./config/env.js";
import { createContainer } from "./container.js";
import { logger, setLogLevel } from "./utils/logger.js";

const config = getConfig();
setLogLevel(config.LOG_LEVEL);

await connectDb(config);
const container = createContainer(config);
if (!container.ai.configured) logger.warn("OPENAI_API_KEY is not set: agent tasks will fail until it is configured.");
if (!container.research.searchAvailable) logger.warn("SEARCH_PROVIDER is 'none': agents run without web search and will report thin evidence.");

const app = createApp(container);
const server = app.listen(config.PORT, () => logger.info("API listening", { port: config.PORT, env: config.NODE_ENV }));
if (config.RUN_WORKER) await container.worker.start();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 30000);
  force.unref();
  server.close();
  await container.worker.stop();
  await disconnectDb();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error("unhandled rejection", { err }));
