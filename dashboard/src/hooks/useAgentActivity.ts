import { useState } from "react";
import { useSocketEvent } from "./useSocket";

export type Activity = "working" | "mcp" | "skill" | "idle" | "waiting";

export interface ActivityState {
  activity: Activity;
  rev: number;
}

const VALID: Activity[] = ["working", "mcp", "skill", "idle", "waiting"];

export function useAgentActivity(): Record<string, ActivityState> {
  const [activities, setActivities] = useState<Record<string, ActivityState>>({});

  useSocketEvent<{ targetType: string; targetName: string; activity: string }>(
    "execution:activity",
    ({ targetType, targetName, activity }) => {
      if (targetType !== "agent" || !VALID.includes(activity as Activity)) return;
      setActivities((prev) => ({
        ...prev,
        [targetName]: { activity: activity as Activity, rev: (prev[targetName]?.rev ?? 0) + 1 },
      }));
    },
  );

  return activities;
}
