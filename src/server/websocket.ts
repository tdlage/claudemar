import type { Server as SocketServer, Socket } from "socket.io";
import { executionManager } from "../execution-manager.js";
import { validateSocketToken } from "./middleware.js";
import { tokenManager } from "./token-manager.js";
import { startFileWatcher, stopFileWatcher } from "./file-watcher.js";

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_EVENTS = 30;

function applyRateLimit(socket: Socket): void {
  let eventCount = 0;
  let windowStart = Date.now();

  socket.onAny(() => {
    const now = Date.now();
    if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
      eventCount = 0;
      windowStart = now;
    }
    eventCount++;
    if (eventCount > RATE_LIMIT_MAX_EVENTS) {
      console.warn(`WebSocket rate limit exceeded: ${socket.id}`);
      socket.emit("error:rate_limit", { message: "Too many events" });
      socket.disconnect(true);
    }
  });
}

export function setupWebSocket(io: SocketServer): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string;
    if (validateSocketToken(token)) {
      next();
    } else {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    applyRateLimit(socket);

    socket.join("executions");

    socket.on("subscribe:execution", (id: string) => {
      socket.join(`exec:${id}`);
    });

    socket.on("unsubscribe:execution", (id: string) => {
      socket.leave(`exec:${id}`);
    });

    socket.on("subscribe:files", () => {
      socket.join("files");
    });

    socket.on("unsubscribe:files", () => {
      socket.leave("files");
    });
  });

  const sweepInvalidSockets = () => {
    for (const [, socket] of io.sockets.sockets) {
      const token = socket.handshake.auth.token as string;
      if (!validateSocketToken(token)) {
        socket.emit("auth:expired");
        socket.disconnect(true);
      }
    }
  };

  tokenManager.on("rotate", sweepInvalidSockets);
  tokenManager.on("grace:expired", sweepInvalidSockets);

  executionManager.on("start", (id, info) => {
    io.to("executions").emit("execution:start", { id, info });
  });

  executionManager.on("output", (id, chunk) => {
    io.to(`exec:${id}`).emit("execution:output", { id, chunk });
  });

  executionManager.on("complete", (id, info) => {
    io.to("executions").emit("execution:complete", { id, info });
    io.to(`exec:${id}`).emit("execution:complete", { id, info });
  });

  executionManager.on("error", (id, info, message) => {
    io.to("executions").emit("execution:error", { id, info, error: message });
    io.to(`exec:${id}`).emit("execution:error", { id, info, error: message });
  });

  executionManager.on("cancel", (id, info) => {
    io.to("executions").emit("execution:cancel", { id, info });
    io.to(`exec:${id}`).emit("execution:cancel", { id, info });
  });

  startFileWatcher((event, base, path) => {
    io.to("files").emit("file:changed", { event, base, path });
  });

  process.on("SIGTERM", stopFileWatcher);
  process.on("SIGINT", stopFileWatcher);
}
