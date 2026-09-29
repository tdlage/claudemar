import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, Square, RotateCw, Play, Server } from "lucide-react";
import { api } from "../../lib/api";
import { useSocketEvent } from "../../hooks/useSocket";
import type { RunConfig } from "../../lib/types";
import { useToast } from "../shared/Toast";

type Action = "start" | "stop" | "restart";

const ACTION_ERRORS: Record<Action, string> = {
  start: "Não foi possível iniciar o processo.",
  stop: "Não foi possível parar o processo.",
  restart: "Não foi possível reiniciar o processo.",
};

export function ProcessIndicator({ variant = "menu" }: { variant?: "menu" | "topbar" }) {
  const { addToast } = useToast();
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<RunConfig[]>("/run-configs").then(setConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useSocketEvent("run:start", load);
  useSocketEvent("run:stop", load);
  useSocketEvent("run:error", load);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const runningCount = configs.filter((c) => c.status?.running).length;

  if (configs.length === 0) return null;

  const grouped = new Map<string, RunConfig[]>();
  for (const c of configs) {
    const key = c.projectName || "Geral";
    const list = grouped.get(key) ?? [];
    list.push(c);
    grouped.set(key, list);
  }

  const run = async (action: Action, id: string) => {
    try {
      await api.post(`/run-configs/${id}/${action}`);
    } catch (err) {
      addToast("error", err instanceof Error && err.message ? `${ACTION_ERRORS[action]} ${err.message}` : ACTION_ERRORS[action]);
    } finally {
      load();
    }
  };
  const handleStart = (id: string) => run("start", id);
  const handleStop = (id: string) => run("stop", id);
  const handleRestart = (id: string) => run("restart", id);

  const summary = `Processos: ${runningCount} de ${configs.length} em execução`;

  return (
    <div ref={ref} className={variant === "topbar" ? "relative" : "relative hidden sm:block"}>
      {variant === "topbar" ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="icon-button relative"
          title={summary}
          aria-label={summary}
          aria-expanded={open}
        >
          <Server size={18} className={runningCount > 0 ? "text-success" : undefined} />
          {runningCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-success text-[10px] font-semibold leading-4 text-center text-bg">
              {runningCount}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title={summary}
          aria-expanded={open}
          className={`flex items-center gap-1 text-xs font-mono transition-colors cursor-pointer ${
            runningCount > 0 ? "text-success" : "text-text-muted"
          } hover:text-text-primary`}
        >
          <Activity size={12} />
          <span>{runningCount}</span>
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-text-primary">
              Processos ({runningCount} em execução)
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {[...grouped.entries()].map(([project, cfgs]) => (
              <div key={project}>
                <div className="px-3 py-1.5 bg-surface-hover">
                  <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    {project}
                  </span>
                </div>
                {cfgs.map((cfg) => {
                  const running = cfg.status?.running ?? false;
                  return (
                    <div
                      key={cfg.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          running ? "bg-success animate-pulse" : "bg-text-muted/30"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text-primary truncate">{cfg.name}</p>
                        {cfg.proxyDomain && (
                          <p className="text-[11px] text-text-muted truncate">
                            {cfg.proxyDomain}{cfg.proxyPort ? `:${cfg.proxyPort}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {running ? (
                          <>
                            <button
                              onClick={() => handleRestart(cfg.id)}
                              className="p-1 text-text-muted hover:text-warning transition-colors cursor-pointer"
                              title="Reiniciar"
                              aria-label={`Reiniciar ${cfg.name}`}
                            >
                              <RotateCw size={11} />
                            </button>
                            <button
                              onClick={() => handleStop(cfg.id)}
                              className="p-1 text-text-muted hover:text-danger transition-colors cursor-pointer"
                              title="Parar"
                              aria-label={`Parar ${cfg.name}`}
                            >
                              <Square size={11} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleStart(cfg.id)}
                            className="p-1 text-text-muted hover:text-success transition-colors cursor-pointer"
                            title="Iniciar"
                            aria-label={`Iniciar ${cfg.name}`}
                          >
                            <Play size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
