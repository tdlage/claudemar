import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { Server as SocketServer } from "socket.io";
import { config } from "../config.js";
import { authMiddleware, requireAdmin, securityHeaders } from "./middleware.js";
import { tokenManager } from "./token-manager.js";
import { setupWebSocket } from "./websocket.js";
import { agentsRouter } from "./routes/agents.js";
import { projectsRouter } from "./routes/projects.js";
import { executionsRouter } from "./routes/executions.js";
import { filesRouter } from "./routes/files.js";
import { orchestratorRouter } from "./routes/orchestrator.js";
import { systemRouter } from "./routes/system.js";
import { runConfigsRouter } from "./routes/run-configs.js";
import { transcriptionRouter } from "./routes/transcription.js";
import { usersRouter } from "./routes/users.js";
import { authRouter } from "./routes/auth.js";

export function createDashboardServer() {
  const app = express();
  app.set("trust proxy", 1);
  const httpServer = createServer(app);

  const io = new SocketServer(httpServer, {
    cors: { origin: false },
  });

  app.use(securityHeaders);

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });

  app.use("/api", apiLimiter);
  app.use("/api", authMiddleware);

  const jsonParser = express.json({ limit: "5mb" });

  app.use("/api/auth", jsonParser, authRouter);
  app.use("/api/agents", express.json({ limit: "15mb" }), agentsRouter);
  app.use("/api/projects", jsonParser, projectsRouter);
  app.use("/api/executions", jsonParser, executionsRouter);
  app.use("/api/files", jsonParser, filesRouter);
  app.use("/api/orchestrator", jsonParser, requireAdmin, orchestratorRouter);
  app.use("/api/system", jsonParser, requireAdmin, systemRouter);
  app.use("/api/run-configs", jsonParser, requireAdmin, runConfigsRouter);
  app.use("/api/users", jsonParser, requireAdmin, usersRouter);
  app.use("/api/transcribe", transcriptionRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const dashboardDist = resolve(process.cwd(), "dashboard/dist");

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(resolve(dashboardDist, "index.html"));
    });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  setupWebSocket(io);
  tokenManager.start();

  return httpServer;
}
