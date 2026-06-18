import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send, Square, Brain, Sparkles, ChevronDown, History, Wrench, AlertTriangle, ImagePlus, Slash, Zap,
} from "lucide-react";
import { getSocket } from "../../lib/socket";
import { getOutput, setOutput, appendOutput } from "../../lib/outputBuffer";
import { extractMdPaths, renderOutputHtml } from "../../lib/ansi";
import { useCurrentModel } from "../../hooks/useCurrentModel";
import { MdLinksBar } from "./MdLinksBar";
import { PermissionPrompt, type PermissionRequest } from "./PermissionPrompt";

type PermissionMode = "default" | "auto" | "plan" | "acceptEdits" | "bypassPermissions";

const MODE_LABELS: Record<PermissionMode, string> = {
  default: "Padrão",
  auto: "Auto",
  plan: "Plano",
  acceptEdits: "Aceitar edições",
  bypassPermissions: "Bypass",
};

const MODE_ORDER: PermissionMode[] = ["default", "plan", "acceptEdits"];

interface ThinkingBlock {
  id: number;
  text: string;
}

interface ToolEvent {
  id: number;
  name: string;
  input: Record<string, unknown>;
}

interface CheckpointEntry {
  uuid: string;
  ts: number;
}

interface UsageState {
  costUsd: number;
  tokens: number;
  contextPct: number;
}

interface TerminalProps {
  executionId: string | null;
  base?: string;
}

function fileToImageBlock(file: File): Promise<{ type: "image"; source: { type: "base64"; media_type: string; data: string } }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(",")[1] ?? "";
      resolve({ type: "image", source: { type: "base64", media_type: file.type || "image/png", data } });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Terminal({ executionId, base }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const currentModel = useCurrentModel();

  const [html, setHtml] = useState("");
  const [mdPaths, setMdPaths] = useState<string[]>([]);

  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<{ type: "image"; source: { type: "base64"; media_type: string; data: string } }[]>([]);
  const [running, setRunning] = useState(false);

  const [thinking, setThinking] = useState<ThinkingBlock[]>([]);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [mode, setMode] = useState<PermissionMode>("default");
  const [ultrathink, setUltrathink] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [compactNotice, setCompactNotice] = useState<string | null>(null);

  const counterRef = useRef(0);

  const render = useCallback((text: string) => {
    setHtml(renderOutputHtml(text || "(sem output)"));
    const paths = extractMdPaths(text);
    if (paths.length > 0) setMdPaths(paths);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [html, thinking, tools, permissions]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 40;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setHtml("");
    setMdPaths([]);
    setThinking([]);
    setTools([]);
    setPermissions([]);
    setCheckpoints([]);
    setUsage(null);
    setCompactNotice(null);
    setSlashCommands([]);
    autoScrollRef.current = true;

    if (!executionId) {
      setRunning(false);
      return;
    }

    setRunning(true);

    const buffered = getOutput(executionId);
    if (buffered) render(buffered);

    const socket = getSocket();
    socket.emit("subscribe:execution", executionId);

    const matches = (id: string) => id === executionId;

    const catchupHandler = (data: { id: string; output: string }) => {
      if (!matches(data.id)) return;
      const current = getOutput(executionId);
      if (data.output.length > current.length) {
        setOutput(executionId, data.output);
        render(data.output);
      }
    };

    const chunkHandler = (data: { id: string; chunk: string }) => {
      if (!matches(data.id)) return;
      appendOutput(data.id, data.chunk);
      render(getOutput(executionId));
    };

    const thinkingHandler = (data: { id: string; chunk: string }) => {
      if (!matches(data.id)) return;
      setThinking((prev) => {
        const last = prev[prev.length - 1];
        if (last) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: last.text + data.chunk };
          return updated;
        }
        return [{ id: counterRef.current++, text: data.chunk }];
      });
    };

    const toolHandler = (data: { id: string; name: string; input: Record<string, unknown> }) => {
      if (!matches(data.id)) return;
      setTools((prev) => [...prev.slice(-30), { id: counterRef.current++, name: data.name, input: data.input }]);
    };

    const permissionHandler = (data: { id: string; reqId: string; toolName: string; input: Record<string, unknown> }) => {
      if (!matches(data.id)) return;
      setPermissions((prev) => [...prev.filter((p) => p.reqId !== data.reqId), { reqId: data.reqId, toolName: data.toolName, input: data.input }]);
    };

    const usageHandler = (data: { id: string; costUsd: number; tokens: number; contextPct: number }) => {
      if (!matches(data.id)) return;
      setUsage({ costUsd: data.costUsd, tokens: data.tokens, contextPct: data.contextPct });
    };

    const modeHandler = (data: { id: string; mode: PermissionMode }) => {
      if (!matches(data.id)) return;
      setMode(data.mode);
    };

    const slashHandler = (data: { id: string; commands: string[] }) => {
      if (!matches(data.id)) return;
      setSlashCommands(data.commands);
    };

    const compactHandler = (data: { id: string; trigger: string }) => {
      if (!matches(data.id)) return;
      setCompactNotice(data.trigger === "auto" ? "Contexto compactado automaticamente" : "Contexto compactado");
    };

    const checkpointHandler = (data: { id: string; uuid: string }) => {
      if (!matches(data.id)) return;
      setCheckpoints((prev) => [...prev.filter((c) => c.uuid !== data.uuid), { uuid: data.uuid, ts: Date.now() }]);
    };

    const completeHandler = (data: { id: string }) => {
      if (!matches(data.id)) return;
      setRunning(false);
      setPermissions([]);
    };

    socket.on("execution:catchup", catchupHandler);
    socket.on("execution:output", chunkHandler);
    socket.on("execution:thinking", thinkingHandler);
    socket.on("execution:tool", toolHandler);
    socket.on("execution:permission", permissionHandler);
    socket.on("execution:usage", usageHandler);
    socket.on("execution:mode", modeHandler);
    socket.on("execution:slash-commands", slashHandler);
    socket.on("execution:compact", compactHandler);
    socket.on("execution:checkpoint", checkpointHandler);
    socket.on("execution:complete", completeHandler);
    socket.on("execution:error", completeHandler);
    socket.on("execution:cancel", completeHandler);

    return () => {
      socket.off("execution:catchup", catchupHandler);
      socket.off("execution:output", chunkHandler);
      socket.off("execution:thinking", thinkingHandler);
      socket.off("execution:tool", toolHandler);
      socket.off("execution:permission", permissionHandler);
      socket.off("execution:usage", usageHandler);
      socket.off("execution:mode", modeHandler);
      socket.off("execution:slash-commands", slashHandler);
      socket.off("execution:compact", compactHandler);
      socket.off("execution:checkpoint", checkpointHandler);
      socket.off("execution:complete", completeHandler);
      socket.off("execution:error", completeHandler);
      socket.off("execution:cancel", completeHandler);
      socket.emit("unsubscribe:execution", executionId);
    };
  }, [executionId, render]);

  const sendMessage = useCallback(() => {
    if (!executionId) return;
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    const socket = getSocket();
    if (pendingImages.length > 0) {
      const blocks = [
        ...pendingImages,
        ...(text ? [{ type: "text" as const, text }] : []),
      ];
      socket.emit("execution:send", { execId: executionId, blocks });
    } else {
      socket.emit("execution:send", { execId: executionId, text });
    }
    setInput("");
    setPendingImages([]);
    setSlashOpen(false);
  }, [executionId, input, pendingImages]);

  const handleInterrupt = useCallback(() => {
    if (!executionId) return;
    getSocket().emit("execution:interrupt", { id: executionId });
  }, [executionId]);

  const handleSetMode = useCallback((next: PermissionMode) => {
    setMode(next);
    if (executionId) getSocket().emit("execution:set-mode", { id: executionId, mode: next });
  }, [executionId]);

  const handleToggleUltrathink = useCallback(() => {
    const next = !ultrathink;
    setUltrathink(next);
    if (executionId) getSocket().emit("execution:set-thinking", { id: executionId, level: next ? "ultrathink" : "off" });
  }, [executionId, ultrathink]);

  const handlePermissionDecision = useCallback((reqId: string, decision: "allow" | "always" | "deny") => {
    if (!executionId) return;
    getSocket().emit("execution:permission:decision", { id: executionId, reqId, decision });
    setPermissions((prev) => prev.filter((p) => p.reqId !== reqId));
  }, [executionId]);

  const handleRewind = useCallback((uuid: string) => {
    if (!executionId) return;
    getSocket().emit("execution:rewind", { id: executionId, uuid });
  }, [executionId]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (items.length === 0) return;
    e.preventDefault();
    const files = items.map((i) => i.getAsFile()).filter((f): f is File => !!f);
    const blocks = await Promise.all(files.map(fileToImageBlock));
    setPendingImages((prev) => [...prev, ...blocks]);
  }, []);

  const insertSlash = useCallback((cmd: string) => {
    setInput((prev) => (prev ? `${prev} /${cmd}` : `/${cmd}`));
    setSlashOpen(false);
  }, []);

  return (
    <div className="flex flex-col w-full h-full min-h-[300px] gap-2">
      <div className="flex items-center gap-2 flex-wrap text-xs shrink-0">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-border text-text-secondary font-medium">
          {currentModel.displayName}
        </span>
        {usage && (
          <>
            <span className="text-text-muted">${usage.costUsd.toFixed(2)}</span>
            <span className="text-text-muted">
              {usage.tokens >= 1000 ? `${(usage.tokens / 1000).toFixed(1)}k tok` : `${usage.tokens} tok`}
            </span>
            <span className={usage.contextPct >= 80 ? "text-warning" : "text-text-muted"}>
              {Math.round(usage.contextPct)}% ctx
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => handleSetMode(mode === "bypassPermissions" ? "default" : "bypassPermissions")}
          disabled={!executionId}
          title="Permissões automáticas: executa tudo sem pedir aprovação. Pode ligar/desligar durante o processamento (equivalente ao Shift+Tab do CLI)."
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors disabled:opacity-40 ${
            mode === "bypassPermissions"
              ? "bg-warning/20 text-warning border-warning/40"
              : "text-text-muted border-border hover:text-text-secondary"
          }`}
        >
          <Zap size={12} /> Auto {mode === "bypassPermissions" ? "ON" : "OFF"}
        </button>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleSetMode(m)}
              disabled={!executionId}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${
                mode === m
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "text-text-muted hover:text-text-secondary border border-transparent"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {compactNotice && (
        <div className="flex items-center gap-1.5 text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1 shrink-0">
          <AlertTriangle size={12} />
          {compactNotice}
        </div>
      )}

      <div
        ref={containerRef}
        className="activity-output flex-1 rounded-md overflow-auto bg-bg p-3 md:p-4 text-sm text-text-primary min-h-0 space-y-2"
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />

        {thinking.length > 0 && (
          <div className="border border-border/60 rounded-md p-2 bg-surface/40">
            <button
              type="button"
              onClick={() => setThinkingCollapsed((v) => !v)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              <Brain size={12} />
              <ChevronDown size={12} className={`transition-transform ${thinkingCollapsed ? "-rotate-90" : ""}`} />
              Pensamento ({thinking.length})
            </button>
            {!thinkingCollapsed && (
              <div className="mt-1 space-y-1.5">
                {thinking.map((t) => (
                  <p key={t.id} className="text-xs italic text-text-muted whitespace-pre-wrap break-words">{t.text}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {tools.length > 0 && (
          <div className="space-y-1">
            {tools.map((t) => (
              <div key={t.id} className="flex items-start gap-1.5 text-xs">
                <Wrench size={12} className="text-accent mt-0.5 shrink-0" />
                <span className="font-mono text-accent">{t.name}</span>
              </div>
            ))}
          </div>
        )}

        {checkpoints.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {checkpoints.map((c) => (
              <button
                key={c.uuid}
                type="button"
                onClick={() => handleRewind(c.uuid)}
                title="Reverter para este ponto"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-muted border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <History size={11} />
                Reverter
              </button>
            ))}
          </div>
        )}
      </div>

      {permissions.length > 0 && (
        <div className="space-y-2 shrink-0">
          {permissions.map((p) => (
            <PermissionPrompt key={p.reqId} request={p} onDecision={handlePermissionDecision} />
          ))}
        </div>
      )}

      {base && <MdLinksBar paths={mdPaths} base={base} />}

      {executionId && (
        <div className="shrink-0 space-y-1.5">
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={`data:${img.source.media_type};base64,${img.source.data}`}
                    alt="anexo"
                    className="h-12 w-12 object-cover rounded border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 bg-bg border border-border rounded-full w-4 h-4 flex items-center justify-center text-[10px] text-text-muted hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative flex items-end gap-2">
            {slashCommands.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSlashOpen((v) => !v)}
                  title="Comandos slash"
                  className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  <Slash size={14} />
                </button>
                {slashOpen && (
                  <div className="absolute bottom-full mb-1 left-0 z-10 bg-surface border border-border rounded-md shadow-lg max-h-60 overflow-auto w-48">
                    {slashCommands.map((cmd) => (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => insertSlash(cmd)}
                        className="block w-full text-left px-3 py-1.5 text-xs font-mono text-text-secondary hover:bg-surface-hover"
                      >
                        /{cmd}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              onPaste={handlePaste}
              placeholder="Mensagem... (Enter envia, Shift+Enter quebra linha, cole imagens)"
              rows={1}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
              style={{ maxHeight: 160 }}
            />
            <button
              type="button"
              onClick={handleToggleUltrathink}
              title={ultrathink ? "Ultrathink ativo" : "Ativar Ultrathink"}
              className={`p-1.5 rounded-md transition-colors ${
                ultrathink ? "bg-accent/20 text-accent border border-accent/40" : "text-text-muted hover:text-text-secondary border border-transparent"
              }`}
            >
              <Sparkles size={14} />
            </button>
            <label
              title="Anexar imagem"
              className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <ImagePlus size={14} />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length === 0) return;
                  const blocks = await Promise.all(files.map(fileToImageBlock));
                  setPendingImages((prev) => [...prev, ...blocks]);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() && pendingImages.length === 0}
              className="inline-flex items-center justify-center p-1.5 rounded-md bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <Send size={14} />
            </button>
            {running && (
              <button
                type="button"
                onClick={handleInterrupt}
                title="Interromper"
                className="inline-flex items-center justify-center p-1.5 rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
              >
                <Square size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
