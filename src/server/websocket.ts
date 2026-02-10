import type { Server as SocketServer } from "socket.io";
import { executionManager } from "../execution-manager.js";
import { validateSocketToken } from "./middleware.js";
import { startFileWatcher, stopFileWatcher } from "./file-watcher.js";

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
