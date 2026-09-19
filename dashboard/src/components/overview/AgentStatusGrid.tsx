import { Link } from "react-router-dom";
import { Bot, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AgentInfo } from "../../lib/types";

export function AgentStatusGrid({ agents }: { agents: AgentInfo[] }) {
  if (!agents.length)
    return <p className="p-4 text-sm text-text-muted">Nenhum agente criado.</p>;
  return (
    <div className="workspace-rows">
      {agents.map((agent) => (
        <Link
          key={agent.name}
          className="workspace-row"
          to={`/agents/${encodeURIComponent(agent.name)}`}
        >
          <span className="workspace-row-icon agent">
            <Bot size={20} strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-sm">
              {agent.name}
            </span>
            <span className="block mt-1 text-xs text-text-secondary">
              {agent.lastExecution && isValid(new Date(agent.lastExecution))
                ? `Última atividade ${formatDistanceToNow(new Date(agent.lastExecution), { addSuffix: true, locale: ptBR })}`
                : "Pronto para a primeira conversa"}
            </span>
          </span>
          <ArrowUpRight size={16} className="text-text-muted shrink-0" />
        </Link>
      ))}
    </div>
  );
}
