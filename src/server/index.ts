import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { Server as SocketServer } from "socket.io";
import { config } from "../config.js";
import { authMiddleware, securityHeaders } from "./middleware.js";
import { tokenManager } from "./token-manager.js";
import { setupWebSocket } from "./websocket.js";
import { agentsRouter } from "./routes/agents.js";
import { projectsRouter } from "./routes/projects.js";
import { executionsRouter } from "./routes/executions.js";
import { filesRouter } from "./routes/files.js";
import { systemRouter } from "./routes/system.js";

export function createDashboardServer() {
  const app = express();
  const httpServer = createServer(app);

  const io = new SocketServer(httpServer, {
    cors: { origin: false },
  });

  app.use(securityHeaders);
  app.use(express.json({ limit: "5mb" }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });

  app.use("/api", apiLimiter);
  app.use("/api", authMiddleware);

  app.use("/api/agents", agentsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/executions", executionsRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/system", systemRouter);

  const dashboardDist = resolve(process.cwd(), "dashboard/dist");

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(resolve(dashboardDist, "index.html"));
    });
  }

  setupWebSocket(io);
  tokenManager.start();

  return httpServer;
}
