import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { AgentInfo, ProjectInfo } from "../../lib/types";

export function QuickCommand() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [target, setTarget] = useState("orchestrator:orchestrator");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || sending) return;

    const [targetType, targetName] = target.split(":");
    setSending(true);

    try {
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>(
        "/executions",
        { targetType, targetName, prompt: prompt.trim() },
      );
      if (result.queued) {
        addToast("success", `Queued (#${result.queueItem?.seqId})`);
      } else {
        addToast("success", "Execution started");
      }
      setPrompt("");

      if (targetType === "agent") {
        navigate(`/agents/${targetName}`);
      } else if (targetType === "project") {
        navigate(`/projects/${targetName}`);
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to start execution");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
      >
        <option value="orchestrator:orchestrator">Orchestrator</option>
        <optgroup label="Agents">
          {agents.map((a) => (
            <option key={a.name} value={`agent:${a.name}`}>{a.name}</option>
          ))}
        </optgroup>
        <optgroup label="Projects">
          {projects.map((p) => (
            <option key={p.name} value={`project:${p.name}`}>{p.name}</option>
          ))}
        </optgroup>
      </select>
      <textarea
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (prompt.trim()) handleSubmit(e);
          }
        }}
        placeholder="Type a command... (Shift+Enter for new line)"
        rows={1}
        className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
        style={{ maxHeight: 200 }}
      />
      <button
        type="submit"
        disabled={sending || !prompt.trim()}
        className="bg-accent hover:bg-accent-hover text-white px-3.5 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center gap-1.5"
      >
        <Send size={14} />
        Send
      </button>
    </form>
  );
}
