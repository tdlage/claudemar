import { agentColor, agentInitial } from "../../lib/avatar";
import type { AgentAppearance } from "../../lib/types";

export type AgentLiveStatus = "running" | "waiting" | "idle";

interface AgentAvatarProps {
  name: string;
  appearance?: AgentAppearance | null;
  size?: number;
  status?: AgentLiveStatus;
  title?: string;
}

const STATUS_RING: Record<AgentLiveStatus, string> = {
  running: "ring-2 ring-warning",
  waiting: "ring-2 ring-accent",
  idle: "ring-1 ring-border",
};

export function AgentAvatar({ name, appearance, size = 32, status = "idle", title }: AgentAvatarProps) {
  const color = agentColor(name, appearance?.color);
  const emoji = appearance?.emoji;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold text-white select-none ${STATUS_RING[status]} ${
        status === "running" ? "animate-pulse" : ""
      }`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.45 }}
      title={title ?? name}
    >
      {emoji ? <span style={{ fontSize: size * 0.55 }}>{emoji}</span> : agentInitial(name)}
    </span>
  );
}
