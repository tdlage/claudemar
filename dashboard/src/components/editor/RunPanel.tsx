import { useState, useEffect, useCallback } from "react";
import { Play, Square, RotateCw, Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useSocketEvent } from "../../hooks/useSocket";
import type { RunConfig } from "../../lib/types";
import { RunConfigForm } from "./RunConfigForm";
import { RunTerminal } from "./RunTerminal";

interface RunPanelProps {
  base: string;
}

export function RunPanel({ base }: RunPanelProps) {
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<RunConfig | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);

  const projectName = base.startsWith("project:") ? base.split(":").slice(1).join(":") : "";

  const loadConfigs = useCallback(() => {
    api.get<RunConfig[]>("/run-configs").then(setConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useSocketEvent<{ configId: string }>("run:start", () => loadConfigs());
  useSocketEvent<{ configId: string }>("run:stop", () => loadConfigs());
  useSocketEvent<{ configId: string }>("run:error", () => loadConfigs());

  const handleSave = useCallback(
    async (data: Omit<RunConfig, "id" | "status">) => {
      if (editingConfig) {
        await api.put(`/run-configs/${editingConfig.id}`, data);
      } else {
        await api.post("/run-configs", data);
      }
      setShowForm(false);
      setEditingConfig(null);
      loadConfigs();
    },
    [editingConfig, loadConfigs],
  );

  const handleStart = useCallback(async (id: string) => {
    await api.post(`/run-configs/${id}/start`);
    setSelectedConfig(id);
  }, []);

  const handleStop = useCallback(async (id: string) => {
    await api.post(`/run-configs/${id}/stop`);
  }, []);

  const handleRestart = useCallback(async (id: string) => {
    await api.post(`/run-configs/${id}/restart`);
    setSelectedConfig(id);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this run configuration?")) return;
      await api.delete(`/run-configs/${id}`);
      if (selectedConfig === id) setSelectedConfig(null);
      loadConfigs();
    },
    [selectedConfig, loadConfigs],
  );

  const filteredConfigs = projectName
    ? configs.filter((c) => c.projectName === projectName || !c.projectName)
    : configs;

  if (showForm || editingConfig) {
    return (
      <RunConfigForm
        initial={editingConfig ?? undefined}
        projectName={projectName}
        onSave={handleSave}
        onCancel={() => {
          setShowForm(false);
          setEditingConfig(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">Run Configurations</span>
        <button
          onClick={() => setShowForm(true)}
          className="text-text-muted hover:text-accent transition-colors"
          title="Add Configuration"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredConfigs.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-text-muted mb-2">No run configurations</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs text-accent hover:text-accent/80 transition-colors"
            >
              Create one
            </button>
          </div>
        )}

        {filteredConfigs.map((cfg) => {
          const isRunning = cfg.status?.running ?? false;
          const isSelected = selectedConfig === cfg.id;

          return (
            <div
              key={cfg.id}
              className={`border-b border-border ${isSelected ? "bg-accent/5" : ""}`}
            >
              <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface-hover transition-colors"
                onClick={() => setSelectedConfig(isSelected ? null : cfg.id)}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isRunning ? "bg-success animate-pulse" : "bg-text-muted/30"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary truncate">{cfg.name}</p>
                  <p className="text-[10px] text-text-muted truncate font-mono">{cfg.command}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {isRunning ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestart(cfg.id);
                        }}
                        className="p-1 text-text-muted hover:text-warning transition-colors"
                        title="Restart"
                      >
                        <RotateCw size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStop(cfg.id);
                        }}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                        title="Stop"
                      >
                        <Square size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStart(cfg.id);
                      }}
                      className="p-1 text-text-muted hover:text-success transition-colors"
                      title="Start"
                    >
                      <Play size={12} />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingConfig(cfg);
                    }}
                    className="p-1 text-text-muted hover:text-text-primary transition-colors"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(cfg.id);
                    }}
                    className="p-1 text-text-muted hover:text-danger transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {isSelected && isRunning && (
                <div className="h-48 border-t border-border">
                  <RunTerminal configId={cfg.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
