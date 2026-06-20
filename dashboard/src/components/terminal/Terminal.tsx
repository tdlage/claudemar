import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send, Square, Brain, Gauge, ChevronDown, History, Wrench, AlertTriangle, ImagePlus, Slash, Zap,
} from "lucide-react";
import { getSocket } from "../../lib/socket";
import { getOutput, setOutput, appendOutput } from "../../lib/outputBuffer";
import { extractMdPaths, renderOutputHtml } from "../../lib/ansi";
import { useCurrentModel } from "../../hooks/useCurrentModel";
import { isAdmin } from "../../hooks/useAuth";
import { formatToolDetail } from "../../lib/toolDetail";
import { fileToImageBlock, imageBlocksFromClipboard, type ImageBlock } from "../../lib/imageBlock";
import { getSlashCache, setSlashCache } from "../../lib/slashCache";
import { MdLinksBar } from "./MdLinksBar";
import { PermissionPrompt, type PermissionRequest } from "./PermissionPrompt";
import { Dropdown } from "../shared/Dropdown";

export type PermissionMode = "default" | "auto" | "plan" | "acceptEdits" | "bypassPermissions";

const MODE_LABELS: Record<PermissionMode, string> = {
  default: "Padrão",
  auto: "Auto",
  plan: "Plano",
  acceptEdits: "Aceitar edições",
  bypassPermissions: "Bypass",
};

const MODE_ORDER: PermissionMode[] = ["default", "plan", "acceptEdits"];

export type Effort = "low" | "medium" | "high" | "extra" | "max" | "ultracode";

const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  extra: "Extra",
  max: "Max",
  ultracode: "Ultracode",
};

const EFFORT_LEVELS = Object.keys(EFFORT_LABELS) as Effort[];

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


export interface StartOpts {
  planMode: boolean;
  permissionMode: PermissionMode;
  effort: Effort;
}

interface UserMessage {
  id: number;
  text: string;
  imageCount: number;
}

interface TerminalProps {
  executionId: string | null;
  base?: string;
  controls?: React.ReactNode;
  inputControls?: React.ReactNode;
  startPlaceholder?: string;
  queueMode?: boolean;
  onStart?: (text: string, images: ImageBlock[], opts: StartOpts) => Promise<void> | void;
}

function startPermissionMode(mode: PermissionMode): PermissionMode {
  return mode === "plan" ? "default" : mode;
}

export function Terminal({ executionId, base, controls, inputControls, startPlaceholder, queueMode, onStart }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const currentModel = useCurrentModel();

  const [html, setHtml] = useState("");
  const [mdPaths, setMdPaths] = useState<string[]>([]);

  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ImageBlock[]>([]);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<UserMessage[]>([]);

  const onStartRef = useRef<TerminalProps["onStart"]>(onStart);
  const modeRef = useRef<PermissionMode>("default");

  const [thinking, setThinking] = useState<ThinkingBlock[]>([]);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [mode, setMode] = useState<PermissionMode>("default");
  const [effort, setEffort] = useState<Effort>("high");
  const slashCacheKey = base ?? "default";
  const [slashCommands, setSlashCommands] = useState<string[]>(() => getSlashCache(slashCacheKey));
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashInputRef = useRef<HTMLTextAreaElement>(null);
  const [compactNotice, setCompactNotice] = useState<string | null>(null);

  const counterRef = useRef(0);
  const prevExecIdRef = useRef<string | null>(null);

  useEffect(() => {
    onStartRef.current = onStart;
    modeRef.current = mode;
  });

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
    setCompactNotice(null);
    autoScrollRef.current = true;

    const prevExecId = prevExecIdRef.current;
    prevExecIdRef.current = executionId;
    if (prevExecId && prevExecId !== executionId) {
      setMessages([]);
    }

    if (!executionId) {
      setRunning(false);
      return;
    }

    setRunning(true);

    const buffered = getOutput(executionId);
    if (buffered) render(buffered);

    const socket = getSocket();
    const resubscribe = () => socket.emit("subscribe:execution", executionId);
    resubscribe();

    const matches = (id: string) => id === executionId;

    const catchupHandler = (data: { id: string; output: string; running?: boolean }) => {
      if (!matches(data.id)) return;
      const current = getOutput(executionId);
      if (data.output.length > current.length) {
        setOutput(executionId, data.output);
        render(data.output);
      }
      if (data.running === false) {
        setRunning(false);
        setPermissions([]);
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

    const modeHandler = (data: { id: string; mode: PermissionMode }) => {
      if (!matches(data.id)) return;
      setMode(data.mode);
    };

    const slashHandler = (data: { id: string; commands: string[] }) => {
      if (!matches(data.id)) return;
      setSlashCommands(data.commands);
      setSlashCache(slashCacheKey, data.commands);
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

    const stopHandler = (data: { id: string }) => {
      if (!matches(data.id)) return;
      setRunning(false);
      setPermissions([]);
    };

    socket.on("connect", resubscribe);
    socket.on("execution:catchup", catchupHandler);
    socket.on("execution:output", chunkHandler);
    socket.on("execution:thinking", thinkingHandler);
    socket.on("execution:tool", toolHandler);
    socket.on("execution:permission", permissionHandler);
    socket.on("execution:mode", modeHandler);
    socket.on("execution:slash-commands", slashHandler);
    socket.on("execution:compact", compactHandler);
    socket.on("execution:checkpoint", checkpointHandler);
    socket.on("execution:complete", completeHandler);
    socket.on("execution:error", stopHandler);
    socket.on("execution:cancel", stopHandler);

    return () => {
      socket.off("connect", resubscribe);
      socket.off("execution:catchup", catchupHandler);
      socket.off("execution:output", chunkHandler);
      socket.off("execution:thinking", thinkingHandler);
      socket.off("execution:tool", toolHandler);
      socket.off("execution:permission", permissionHandler);
      socket.off("execution:mode", modeHandler);
      socket.off("execution:slash-commands", slashHandler);
      socket.off("execution:compact", compactHandler);
      socket.off("execution:checkpoint", checkpointHandler);
      socket.off("execution:complete", completeHandler);
      socket.off("execution:error", stopHandler);
      socket.off("execution:cancel", stopHandler);
      socket.emit("unsubscribe:execution", executionId);
    };
  }, [executionId, render]);

  const submit = useCallback(() => {
    const text = input.trim();
    const images = pendingImages;
    if (!text && images.length === 0) return;

    const injectIntoRunning = running && executionId !== null && !queueMode;
    const willQueue = running && executionId !== null && queueMode;

    if (!willQueue) {
      const msgId = counterRef.current++;
      setMessages((prev) => [...prev.slice(-29), { id: msgId, text, imageCount: images.length }]);
    }

    if (injectIntoRunning) {
      const socket = getSocket();
      if (images.length > 0) {
        socket.emit("execution:send", { execId: executionId, blocks: [...images, ...(text ? [{ type: "text" as const, text }] : [])] });
      } else {
        socket.emit("execution:send", { execId: executionId, text });
      }
    } else if (onStartRef.current) {
      const m = modeRef.current;
      void onStartRef.current(text, images, { planMode: m === "plan", permissionMode: startPermissionMode(m), effort });
      if (m === "plan") setMode("default");
    }

    setInput("");
    setPendingImages([]);
  }, [input, pendingImages, running, executionId, queueMode, effort]);

  const handleInterrupt = useCallback(() => {
    if (!executionId) return;
    getSocket().emit("execution:interrupt", { id: executionId });
  }, [executionId]);

  const handleSetMode = useCallback((next: PermissionMode) => {
    setMode(next);
    if (executionId) getSocket().emit("execution:set-mode", { id: executionId, mode: next });
  }, [executionId]);

  const handleSetEffort = useCallback((next: Effort) => {
    setEffort(next);
    if (executionId) getSocket().emit("execution:set-effort", { id: executionId, effort: next });
  }, [executionId]);

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
    const blocks = await imageBlocksFromClipboard(e.clipboardData);
    if (blocks.length === 0) return;
    e.preventDefault();
    setPendingImages((prev) => [...prev, ...blocks]);
  }, []);

  const selectSlash = useCallback((cmd: string) => {
    setInput(`/${cmd} `);
    setSlashIndex(0);
    setSlashDismissed(false);
    slashInputRef.current?.focus();
  }, []);

  const slashActive = input.startsWith("/") && !input.slice(1).includes(" ") && !slashDismissed;
  const slashMatches = slashActive
    ? slashCommands.filter((c) => c.toLowerCase().startsWith(input.slice(1).toLowerCase()))
    : [];
  const slashSel = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));

  return (
    <div className="flex flex-col w-full h-full min-h-[300px] gap-2">
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
            {tools.map((t) => {
              const detail = formatToolDetail(t.name, t.input);
              return (
                <div key={t.id} className="flex items-start gap-1.5 text-xs min-w-0">
                  <Wrench size={12} className="text-accent mt-0.5 shrink-0" />
                  <span className="font-mono text-accent shrink-0">{t.name}</span>
                  {detail && (
                    <span className="font-mono text-text-muted truncate" title={detail}>{detail}</span>
                  )}
                </div>
              );
            })}
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

      <div className="flex items-center gap-2 flex-wrap text-xs shrink-0">
        {inputControls}
        <div className="flex-1" />
        {controls}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-border text-text-secondary font-medium">
          {currentModel.displayName}
        </span>
        {isAdmin() && (
          <>
            <div className="w-px h-4 bg-border" />
            <button
              type="button"
              onClick={() => handleSetMode(mode === "bypassPermissions" ? "default" : "bypassPermissions")}
              title="Permissões automáticas: executa tudo sem pedir aprovação. Pode ligar/desligar durante o processamento (equivalente ao Shift+Tab do CLI)."
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                mode === "bypassPermissions"
                  ? "bg-warning/20 text-warning border-warning/40"
                  : "text-text-muted border-border hover:text-text-secondary"
              }`}
            >
              <Zap size={12} /> Auto {mode === "bypassPermissions" ? "ON" : "OFF"}
            </button>
          </>
        )}
        <div className="flex items-center gap-1">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleSetMode(m)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
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

      {onStart && (
        <div className="shrink-0 space-y-1.5">
          {messages.length > 0 && (
            <div className="space-y-1">
              {messages.slice(-6).map((m) => (
                <div key={m.id} className="flex items-start gap-1.5 text-xs">
                  <span className="text-text-muted shrink-0">›</span>
                  <span className="flex-1 text-text-secondary whitespace-pre-wrap break-words min-w-0">
                    {m.text || (m.imageCount > 0 ? `(${m.imageCount} imagem${m.imageCount > 1 ? "s" : ""})` : "")}
                    {m.text && m.imageCount > 0 ? ` (+${m.imageCount} img)` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
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
            {slashMatches.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-72 max-h-56 overflow-auto rounded-md border border-border bg-surface shadow-lg z-20 py-1">
                {slashMatches.map((cmd, i) => (
                  <button
                    key={cmd}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectSlash(cmd); }}
                    onMouseEnter={() => setSlashIndex(i)}
                    className={`flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-xs ${
                      i === slashSel ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-hover"
                    }`}
                  >
                    <Slash size={11} className="shrink-0 opacity-60" />
                    /{cmd}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={slashInputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSlashIndex(0);
                setSlashDismissed(false);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (slashMatches.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((slashSel + 1) % slashMatches.length); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((slashSel - 1 + slashMatches.length) % slashMatches.length); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectSlash(slashMatches[slashSel]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setSlashDismissed(true); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              onPaste={handlePaste}
              placeholder={running ? (queueMode ? "Mensagem... (vai pra fila durante a execução)" : "Mensagem... (enviada na hora durante a execução)") : (startPlaceholder ?? "Mensagem... (Enter envia, / para comandos, cole imagens)")}
              rows={1}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
              style={{ maxHeight: 160 }}
            />
            <Dropdown
              align="right"
              direction="up"
              menuClassName="w-44"
              triggerTitle={`Esforço de raciocínio: ${EFFORT_LABELS[effort]}`}
              triggerClassName={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                effort === "high"
                  ? "text-text-muted border-transparent hover:text-text-secondary"
                  : "bg-accent/20 text-accent border-accent/40"
              }`}
              triggerContent={
                <>
                  <Gauge size={14} />
                  <span className="hidden sm:inline">{EFFORT_LABELS[effort]}</span>
                </>
              }
            >
              {(close) => (
                <>
                  <div className="flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wide text-text-muted">
                    <span>Mais rápido</span>
                    <span>Mais preciso</span>
                  </div>
                  {EFFORT_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => { handleSetEffort(lvl); close(); }}
                      className={`flex items-center justify-between gap-2 w-full text-left px-3 py-1.5 text-xs ${
                        effort === lvl ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      {EFFORT_LABELS[lvl]}
                      {lvl === "ultracode" && <Zap size={11} className="opacity-70" />}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
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
              onClick={submit}
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
