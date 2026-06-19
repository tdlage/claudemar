import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useSocketEvent } from "./useSocket";
import { useExecutions } from "./useExecution";
import type { TeamsOverview } from "../lib/types";

export type AgentLiveStatus = "running" | "waiting" | "idle";

export function useTeams() {
  const [overview, setOverview] = useState<TeamsOverview | null>(null);
  const { active, recent, pendingQuestions } = useExecutions();

  const reload = useCallback(() => {
    api.get<TeamsOverview>("/teams/overview").then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useSocketEvent("team:updated", reload);

  const statusOf = useCallback(
    (agentName: string): AgentLiveStatus => {
      if (pendingQuestions.some((pq) => pq.info.targetType === "agent" && pq.info.targetName === agentName)) {
        return "waiting";
      }
      if (active.some((e) => e.targetType === "agent" && e.targetName === agentName)) {
        return "running";
      }
      return "idle";
    },
    [active, pendingQuestions],
  );

  return { overview, reload, statusOf, recent };
}
