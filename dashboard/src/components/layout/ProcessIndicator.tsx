import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, Square, RotateCw } from "lucide-react";
import { api } from "../../lib/api";
import { useSocketEvent } from "../../hooks/useSocket";
import type { RunConfig } from "../../lib/types";

export function ProcessIndicator() {
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
    const key = c.projectName || "Other";
    const list = grouped.get(key) ?? [];
    list.push(c);
    grouped.set(key, list);
  }

  const handleStop = async (id: string) => {
    await api.post(`/run-configs/${id}/stop`).catch(() => {});
  };

  const handleRestart = async (id: string) => {
    await api.post(`/run-configs/${id}/restart`).catch(() => {});
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-xs font-mono transition-colors ${
          runningCount > 0 ? "text-success" : "text-text-muted"
        } hover:text-text-primary`}
      >
        <Activity size={12} />
        <span>{runningCount}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-text-primary">
              Processes ({runningCount} running)
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
                        <p className="text-xs text-text-primary truncate">{cfg.name}</p>
                      </div>
                      {running && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => handleRestart(cfg.id)}
                            className="p-1 text-text-muted hover:text-warning transition-colors"
                            title="Restart"
                          >
                            <RotateCw size={11} />
                          </button>
                          <button
                            onClick={() => handleStop(cfg.id)}
                            className="p-1 text-text-muted hover:text-danger transition-colors"
                            title="Stop"
                          >
                            <Square size={11} />
                          </button>
                        </div>
                      )}
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
