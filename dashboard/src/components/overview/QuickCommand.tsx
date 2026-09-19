import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Send } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Button } from "../shared/Button";
import { WORKSPACES_CHANGED_EVENT } from "../../lib/workspaceEvents";
import type { AgentInfo, ProjectInfo } from "../../lib/types";

export function QuickCommand() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [target, setTarget] = useState("orchestrator:orchestrator");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const load = () => {
      api
        .get<AgentInfo[]>("/agents")
        .then(setAgents)
        .catch(() => {});
      api
        .get<ProjectInfo[]>("/projects")
        .then(setProjects)
        .catch(() => {});
    };
    load();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, load);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, load);
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || submitting.current) return;
    const [targetType, targetName] = target.split(":");
    submitting.current = true;
    setSending(true);
    setError("");
    try {
      const result = await api.post<{
        queued?: boolean;
        queueItem?: { seqId: number };
      }>("/executions", { targetType, targetName, prompt: prompt.trim() });
      addToast(
        "success",
        result.queued
          ? "Pedido adicionado à fila. Você pode acompanhar na conversa."
          : "Conversa iniciada.",
      );
      setPrompt("");
      navigate(
        targetType === "orchestrator"
          ? "/orchestrator"
          : `/${targetType === "agent" ? "agents" : "projects"}/${encodeURIComponent(targetName)}`,
      );
    } catch {
      setError(
        "Não foi possível enviar. Seu texto foi preservado; tente novamente.",
      );
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const suggestions = [
    "Planeje os próximos passos do meu projeto",
    "Revise meu código e sugira melhorias",
    "Organize minhas tarefas por prioridade",
  ];
  return (
    <form onSubmit={submit} className="quick-command">
      <label htmlFor="quick-prompt" className="sr-only">
        O que você quer fazer?
      </label>
      <textarea
        id="quick-prompt"
        ref={input}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setError("");
        }}
        disabled={sending}
        aria-describedby={error ? "quick-error" : "quick-hint"}
        aria-invalid={!!error}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void submit(event);
          }
        }}
        placeholder="Descreva uma ideia, faça uma pergunta ou peça ajuda com uma tarefa…"
        rows={3}
        className="quick-prompt"
      />
      <div className="quick-command-footer">
        <label className="command-target">
          <span>Conversar com</span>
          <select
            aria-label="Onde executar"
            value={target}
            disabled={sending}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="orchestrator:orchestrator">
              Assistente Claudemar
            </option>
            {agents.length > 0 && (
              <optgroup label="Agentes">
                {agents.map((a) => (
                  <option key={a.name} value={`agent:${a.name}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {projects.length > 0 && (
              <optgroup label="Projetos">
                {projects.map((p) => (
                  <option key={p.name} value={`project:${p.name}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="flex items-center gap-4">
          <span
            id="quick-hint"
            className="text-xs text-text-muted hidden lg:inline"
          >
            Ctrl / ⌘ + Enter para enviar
          </span>
          <Button
            type="submit"
            variant="primary"
            loading={sending}
            disabled={!prompt.trim()}
          >
            <Send size={15} /> Enviar
          </Button>
        </div>
      </div>
      {error && (
        <p id="quick-error" role="alert" className="quick-error">
          {error}
        </p>
      )}
      <div className="command-suggestions">
        <span>Experimente</span>
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            disabled={sending}
            onClick={() => {
              setPrompt(text);
              input.current?.focus();
            }}
          >
            <span>{text}</span>
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
    </form>
  );
}
