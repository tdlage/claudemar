import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useExecutions } from "../hooks/useExecution";
import { ExecutionCard } from "../components/overview/ExecutionCard";
import { AgentStatusGrid } from "../components/overview/AgentStatusGrid";
import { ProjectStatusGrid } from "../components/overview/ProjectStatusGrid";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { QuickCommand } from "../components/overview/QuickCommand";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Modal } from "../components/shared/Modal";
import type { AgentInfo, ProjectInfo } from "../lib/types";

export function OverviewPage() {
  const { active, recent, queue, pendingQuestions, submitAnswer } = useExecutions();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [viewingExecId, setViewingExecId] = useState<string | null>(null);
  const prevActiveCount = useRef(active.length);

  const loadProjects = useCallback(() => {
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (prevActiveCount.current > 0 && active.length < prevActiveCount.current) {
      loadProjects();
    }
    prevActiveCount.current = active.length;
  }, [active.length, loadProjects]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">Quick Command</h2>
        <QuickCommand />
      </div>

      {pendingQuestions.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wider">
            Pending Questions ({pendingQuestions.length})
          </h2>
          <div className="space-y-3">
            {pendingQuestions.map((pq) => (
              <QuestionPanel
                key={pq.execId}
                execId={pq.execId}
                question={pq.question}
                targetName={pq.info.targetName}
                onSubmit={submitAnswer}
                onDismiss={(id) => {
                  api.post(`/executions/${id}/stop`).catch(() => {});
                }}
              />
            ))}
          </div>
        </div>
      )}

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
