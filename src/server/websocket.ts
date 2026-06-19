import type { Server as SocketServer, Socket } from "socket.io";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { executionManager, type ExecutionInfo } from "../execution-manager.js";
import type { MessageBlock, PermissionDecision } from "../claude/session.js";
import type { ThinkingLevel } from "../claude/options.js";
import { commandQueue } from "../queue.js";
import { teamEvents } from "../agents/teams-manager.js";
import { runProcessManager } from "../run-process-manager.js";
import { resolveContext, type RequestContext } from "./middleware.js";
import { tokenManager } from "./token-manager.js";
import { startFileWatcher, stopFileWatcher } from "./file-watcher.js";
import { trackerManager } from "../tracker-manager.js";
import { ciEventManager } from "../ci-events.js";

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

function canAccessExecution(ctx: RequestContext | undefined, info: ExecutionInfo | undefined): boolean {
  if (!ctx || !info) return false;
  if (ctx.role === "admin") return true;
  if (info.username && info.username === ctx.name) return true;
  if (info.targetType === "project") return ctx.projects.includes(info.targetName);
  if (info.targetType === "agent") return ctx.agents.includes(info.targetName);
  return false;
}

export function setupWebSocket(io: SocketServer): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string;
    const ctx = resolveContext(token);
    if (!ctx) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.ctx = ctx;
    next();
  });

  io.on("connection", (socket) => {
    applyRateLimit(socket);

    const getCtx = (): RequestContext | undefined => socket.data.ctx as RequestContext | undefined;
    const canAccess = (id: string): boolean => canAccessExecution(getCtx(), executionManager.getExecution(id));

    socket.join("executions");

    socket.on("subscribe:execution", (id: string) => {
      if (!canAccess(id)) return;
      socket.join(`exec:${id}`);
      const exec = executionManager.getExecution(id);
      if (exec) {
        socket.emit("execution:catchup", {
          id,
          output: exec.output ?? "",
          running: executionManager.isExecutionActive(id),
        });
        for (const p of executionManager.getPendingPermissions(id)) {
          socket.emit("execution:permission", { id, reqId: p.reqId, toolName: p.toolName, input: p.input });
        }
      }
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

    const ownsExecution = (id: string): boolean => canAccess(id);

    socket.on("execution:answer", ({ execId, answer }: { execId: string; answer: string }) => {
      if (!ownsExecution(execId)) return;
      executionManager.submitAnswer(execId, answer);
    });

    socket.on("execution:send", ({ execId, blocks, text }: { execId: string; blocks?: MessageBlock[]; text?: string }) => {
      if (!ownsExecution(execId)) return;
      const payload = blocks && blocks.length > 0 ? blocks : (text ?? "");
      executionManager.sendMessage(execId, payload);
    });

    socket.on("execution:interrupt", ({ id }: { id: string }) => {
      if (!ownsExecution(id)) return;
      executionManager.interrupt(id).catch(() => {});
    });

    socket.on("execution:set-mode", ({ id, mode }: { id: string; mode: PermissionMode }) => {
      if (!ownsExecution(id)) return;
      if (mode === "bypassPermissions" && getCtx()?.role !== "admin") return;
      executionManager.setPermissionMode(id, mode).catch(() => {});
    });

    socket.on("execution:set-thinking", ({ id, level }: { id: string; level: ThinkingLevel }) => {
      if (!ownsExecution(id)) return;
      executionManager.setThinking(id, level).catch(() => {});
    });

    socket.on("execution:permission:decision", ({ id, reqId, decision }: { id: string; reqId: string; decision: PermissionDecision }) => {
      if (!ownsExecution(id)) return;
      executionManager.respondPermission(id, reqId, decision);
    });

    socket.on("execution:rewind", ({ id, uuid }: { id: string; uuid: string }) => {
      if (!ownsExecution(id)) return;
      executionManager.rewind(id, uuid).catch(() => {});
    });

    socket.on("subscribe:run", (configId: string) => {
      socket.join(`run:${configId}`);
      const output = runProcessManager.getOutput(configId);
      if (output) {
        socket.emit("run:catchup", { configId, output });
      }
    });

    socket.on("unsubscribe:run", (configId: string) => {
      socket.leave(`run:${configId}`);
    });

    socket.on("subscribe:tracker", () => {
      socket.join("tracker");
    });

    socket.on("unsubscribe:tracker", () => {
      socket.leave("tracker");
    });
  });

  const sweepInvalidSockets = () => {
    for (const [, socket] of io.sockets.sockets) {
      const token = socket.handshake.auth.token as string;
      const ctx = resolveContext(token);
      if (!ctx) {
        socket.emit("auth:expired");
        socket.disconnect(true);
      } else {
        socket.data.ctx = ctx;
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

  executionManager.prependListener("complete", (id, info) => {
    const hasQueued = commandQueue.getByTarget(info.targetType, info.targetName).length > 0;
    io.to("executions").emit("execution:complete", { id, info, hasQueued });
    io.to(`exec:${id}`).emit("execution:complete", { id, info, hasQueued });
  });

  executionManager.prependListener("error", (id, info, message) => {
    const hasQueued = commandQueue.getByTarget(info.targetType, info.targetName).length > 0;
    io.to("executions").emit("execution:error", { id, info, error: message, hasQueued });
    io.to(`exec:${id}`).emit("execution:error", { id, info, error: message, hasQueued });
  });

  executionManager.prependListener("cancel", (id, info) => {
    const hasQueued = commandQueue.getByTarget(info.targetType, info.targetName).length > 0;
    io.to("executions").emit("execution:cancel", { id, info, hasQueued });
    io.to(`exec:${id}`).emit("execution:cancel", { id, info, hasQueued });
  });

  executionManager.on("thinking", (id, chunk) => {
    io.to(`exec:${id}`).emit("execution:thinking", { id, chunk });
  });

  executionManager.on("tool", (id, name, input, kind) => {
    io.to(`exec:${id}`).emit("execution:tool", { id, name, input, kind });
  });

  executionManager.on("permission", (id, reqId, toolName, input) => {
    io.to(`exec:${id}`).emit("execution:permission", { id, reqId, toolName, input });
  });

  executionManager.on("mode", (id, mode) => {
    io.to(`exec:${id}`).emit("execution:mode", { id, mode });
  });

  executionManager.on("usage", (id, costUsd, tokens, contextPct) => {
    io.to(`exec:${id}`).emit("execution:usage", { id, costUsd, tokens, contextPct });
  });

  executionManager.on("slash-commands", (id, commands) => {
    io.to(`exec:${id}`).emit("execution:slash-commands", { id, commands });
  });

  executionManager.on("mcp-status", (id, servers) => {
    io.to(`exec:${id}`).emit("execution:mcp-status", { id, servers });
  });

  executionManager.on("compact", (id, trigger) => {
    io.to(`exec:${id}`).emit("execution:compact", { id, trigger });
  });

  executionManager.on("checkpoint", (id, uuid) => {
    io.to(`exec:${id}`).emit("execution:checkpoint", { id, uuid });
  });

  executionManager.on("question", (id, info) => {
    io.to("executions").emit("execution:question", { id, info });
    io.to(`exec:${id}`).emit("execution:question", { id, info });
  });

  executionManager.on("question:answered", (id, info) => {
    io.to("executions").emit("execution:question:answered", { id, info });
    io.to(`exec:${id}`).emit("execution:question:answered", { id, info });
  });

  teamEvents.on("changed", () => {
    io.to("executions").emit("team:updated", {});
  });

  commandQueue.on("queue:add", (item) => {
    io.to("executions").emit("queue:add", { item });
  });

  commandQueue.on("queue:remove", (item) => {
    io.to("executions").emit("queue:remove", { item });
  });

  runProcessManager.on("start", (configId, cfg) => {
    io.to("executions").emit("run:start", { configId, config: cfg });
  });

  runProcessManager.on("output", (configId, chunk) => {
    io.to(`run:${configId}`).emit("run:output", { configId, chunk });
  });

  runProcessManager.on("stop", (configId, exitCode) => {
    io.to("executions").emit("run:stop", { configId, exitCode });
    io.to(`run:${configId}`).emit("run:stop", { configId, exitCode });
  });

  runProcessManager.on("error", (configId, error) => {
    io.to("executions").emit("run:error", { configId, error });
    io.to(`run:${configId}`).emit("run:error", { configId, error });
  });

  const trackerEvents = [
    "project:create", "project:update", "project:delete",
    "cycle:create", "cycle:update", "cycle:delete",
    "item:create", "item:update", "item:delete",
    "comment:add", "comment:delete",
    "testcase:create", "testcase:update", "testcase:delete", "testcase:reorder",
    "testrun:create", "testrun:update", "testrun:delete", "testrun:attachment", "testrun:comment",
    "plan:create", "plan:update", "plan:delete",
  ];
  for (const event of trackerEvents) {
    trackerManager.on(event, (data) => {
      io.to("tracker").emit(`tracker:${event}`, data);
    });
  }

  ciEventManager.on("workflow_run", (data) => {
    io.to("executions").emit("ci:workflow_run", data);
  });

  startFileWatcher((event, base, path) => {
    io.to("files").emit("file:changed", { event, base, path });
  });

  process.on("SIGTERM", stopFileWatcher);
  process.on("SIGINT", stopFileWatcher);
}
