import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { useExecutions } from "../hooks/useExecution";
import { ExecutionCard } from "../components/overview/ExecutionCard";
import { AgentStatusGrid } from "../components/overview/AgentStatusGrid";
import { ProjectStatusGrid } from "../components/overview/ProjectStatusGrid";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { QuickCommand } from "../components/overview/QuickCommand";
import { Terminal } from "../components/terminal/Terminal";
import { Modal } from "../components/shared/Modal";
import type { AgentInfo, ProjectInfo } from "../lib/types";

export function OverviewPage() {
  const { active, recent, queue } = useExecutions();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [viewingExecId, setViewingExecId] = useState<string | null>(null);

  useEffect(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">Quick Command</h2>
        <QuickCommand />
      </div>

      {active.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">
            Active Executions ({active.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((exec) => (
              <ExecutionCard
                key={exec.id}
                execution={exec}
                onViewOutput={setViewingExecId}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">Agents</h2>
          <AgentStatusGrid agents={agents} />
        </div>
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">Projects</h2>
          <ProjectStatusGrid projects={projects} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">Recent Activity</h2>
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <ActivityFeed executions={recent} queue={queue} />
        </div>
      </div>

      <Modal
        open={!!viewingExecId}
        onClose={() => setViewingExecId(null)}
        title="Execution Output"
      >
        <div className="h-[400px]">
          <Terminal executionId={viewingExecId} />
        </div>
      </Modal>
    </div>
  );
}
