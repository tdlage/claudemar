import { agentColor, agentInitial } from "../../lib/avatar";
import type { AgentAppearance } from "../../lib/types";
import type { AgentLiveStatus } from "../../hooks/useTeams";

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

export function AvatarStack({
  names,
  appearances,
  max = 5,
  size = 28,
}: {
  names: string[];
  appearances?: Record<string, AgentAppearance>;
  max?: number;
  size?: number;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((name, i) => (
        <span key={name} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: max - i }} className="ring-2 ring-surface rounded-full">
          <AgentAvatar name={name} appearance={appearances?.[name]} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-border text-text-secondary text-xs font-medium ring-2 ring-surface"
          style={{ width: size, height: size, marginLeft: -size * 0.3 }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
