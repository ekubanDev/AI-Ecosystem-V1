import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "./middleware/errorMiddleware.js";
import { authLimiter, globalLimiter, leadLimiter, viewLimiter } from "./middleware/rateLimit.js";
import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import agentRoutes from "./routes/agentRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import discoveryRoutes from "./routes/discoveryRoutes.js";
import experimentRoutes from "./routes/experimentRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import opportunityRoutes from "./routes/opportunityRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import userRoutes from "./routes/userRoutes.js";

export function createApp(container) {
  const { config } = container;
  const app = express();
  app.locals.container = container;
  app.set("trust proxy", config.trustProxy);
  app.set("query parser", "simple"); // no nested objects from ?a[$gt]=x
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => (!origin || config.clientOrigins.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
      credentials: true,
      exposedHeaders: ["X-Request-ID", "Idempotent-Replayed"],
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  if (!config.isTest) app.use(requestLogger);
  app.use(globalLimiter(config));

  app.get("/api/health", (req, res) =>
    res.json({ success: true, data: { status: mongoose.connection.readyState === 1 ? "ok" : "degraded", db: mongoose.connection.readyState === 1 }, meta: { requestId: req.id } })
  );

  app.use("/api/auth", authRoutes(authLimiter(config)));
  app.use("/api/opportunities", opportunityRoutes);
  app.use("/api/discovery", discoveryRoutes(config));
  app.use("/api/experiments", experimentRoutes);
  app.use("/api/agents", agentRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/leads", leadRoutes);
  app.use("/api/public", publicRoutes(leadLimiter(config), viewLimiter(config)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
