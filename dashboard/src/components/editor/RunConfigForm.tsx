import { useState, useCallback } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { RunConfig } from "../../lib/types";

interface RunConfigFormProps {
  initial?: RunConfig;
  projectName: string;
  onSave: (data: Omit<RunConfig, "id" | "status">) => void;
  onCancel: () => void;
}

export function RunConfigForm({ initial, projectName, onSave, onCancel }: RunConfigFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(initial?.workingDirectory ?? "");
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>(
    initial?.envVars
      ? Object.entries(initial.envVars).map(([key, value]) => ({ key, value }))
      : [],
  );

  const addEnvPair = useCallback(() => {
    setEnvPairs((prev) => [...prev, { key: "", value: "" }]);
  }, []);

  const removeEnvPair = useCallback((index: number) => {
    setEnvPairs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEnvPair = useCallback(
    (index: number, field: "key" | "value", val: string) => {
      setEnvPairs((prev) =>
        prev.map((pair, i) => (i === index ? { ...pair, [field]: val } : pair)),
      );
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !command.trim()) return;
    const envVars: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) {
        envVars[pair.key.trim()] = pair.value;
      }
    }
    onSave({ name, command, workingDirectory, envVars, projectName });
  }, [name, command, workingDirectory, envPairs, projectName, onSave]);

  const inputClass =
    "w-full bg-bg border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-text-primary">
          {initial ? "Edit Configuration" : "New Configuration"}
        </h3>
        <button
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-[11px] text-text-muted block mb-0.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Server"
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-[11px] text-text-muted block mb-0.5">Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm run dev"
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-[11px] text-text-muted block mb-0.5">Working Directory</label>
          <input
            type="text"
            value={workingDirectory}
            onChange={(e) => setWorkingDirectory(e.target.value)}
            placeholder="/path/to/project"
            className={inputClass}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-text-muted">Environment Variables</label>
            <button
              onClick={addEnvPair}
              className="text-text-muted hover:text-accent transition-colors"
              title="Add Variable"
            >
              <Plus size={12} />
            </button>
          </div>
          {envPairs.map((pair, i) => (
            <div key={i} className="flex gap-1 mb-1">
              <input
                type="text"
                value={pair.key}
                onChange={(e) => updateEnvPair(i, "key", e.target.value)}
                placeholder="KEY"
                className={`${inputClass} flex-[2]`}
              />
              <input
                type="text"
                value={pair.value}
                onChange={(e) => updateEnvPair(i, "value", e.target.value)}
                placeholder="value"
                className={`${inputClass} flex-[3]`}
              />
              <button
                onClick={() => removeEnvPair(i)}
                className="text-text-muted hover:text-danger transition-colors px-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary border border-border rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !command.trim()}
          className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors disabled:opacity-40"
        >
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}
