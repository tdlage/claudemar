import { useState, useCallback } from "react";
import { getSocket } from "../lib/socket";
import { useSocketEvent } from "./useSocket";

export interface AgentPermission {
  execId: string;
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type PermissionDecision = "allow" | "always" | "deny";

export function useAgentPermissions(): {
  byAgent: Record<string, AgentPermission[]>;
  respond: (execId: string, reqId: string, decision: PermissionDecision) => void;
} {
  const [byAgent, setByAgent] = useState<Record<string, AgentPermission[]>>({});

  useSocketEvent<{ id: string; targetName: string; reqId: string; toolName: string; input: Record<string, unknown> }>(
    "agent:permission",
    (d) => {
      setByAgent((prev) => {
        const list = (prev[d.targetName] ?? []).filter((p) => p.reqId !== d.reqId);
        return { ...prev, [d.targetName]: [...list, { execId: d.id, reqId: d.reqId, toolName: d.toolName, input: d.input }] };
      });
    },
  );

  useSocketEvent<{ targetName: string; reqId: string }>("agent:permission:resolved", (d) => {
    setByAgent((prev) => {
      const list = (prev[d.targetName] ?? []).filter((p) => p.reqId !== d.reqId);
      if (list.length === (prev[d.targetName]?.length ?? 0)) return prev;
      return { ...prev, [d.targetName]: list };
    });
  });

  const clearExec = useCallback((d: { id: string }) => {
    setByAgent((prev) => {
      let changed = false;
      const next: Record<string, AgentPermission[]> = {};
      for (const [name, list] of Object.entries(prev)) {
        const kept = list.filter((p) => p.execId !== d.id);
        if (kept.length !== list.length) changed = true;
        next[name] = kept;
      }
      return changed ? next : prev;
    });
  }, []);
  useSocketEvent<{ id: string }>("execution:complete", clearExec);
  useSocketEvent<{ id: string }>("execution:error", clearExec);
  useSocketEvent<{ id: string }>("execution:cancel", clearExec);

  const respond = useCallback((execId: string, reqId: string, decision: PermissionDecision) => {
    getSocket().emit("execution:permission:decision", { id: execId, reqId, decision });
    setByAgent((prev) => {
      const next: Record<string, AgentPermission[]> = {};
      for (const [name, list] of Object.entries(prev)) next[name] = list.filter((p) => p.reqId !== reqId);
      return next;
    });
  }, []);

  return { byAgent, respond };
}
