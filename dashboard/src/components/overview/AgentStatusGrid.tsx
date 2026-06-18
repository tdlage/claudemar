import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card } from "../shared/Card";
import type { AgentInfo } from "../../lib/types";

interface AgentStatusGridProps {
  agents: AgentInfo[];
}

export function AgentStatusGrid({ agents }: AgentStatusGridProps) {
  const navigate = useNavigate();

  if (agents.length === 0) {
    return <p className="text-sm text-text-muted">No agents configured.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {agents.map((agent) => (
        <Card key={agent.name} onClick={() => navigate(`/agents/${agent.name}`)}>
          <div className="flex items-center gap-2 mb-2">
            <Bot size={16} className="text-accent" />
            <span className="text-sm font-medium">{agent.name}</span>
          </div>
          <div className="flex items-center justify-end text-xs text-text-muted">
            <span>
              {agent.lastExecution
                ? formatDistanceToNow(new Date(agent.lastExecution), { addSuffix: true })
                : "never"}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
