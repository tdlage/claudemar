import type { LucideIcon } from "lucide-react";

interface ToggleButtonProps {
  active: boolean;
  onToggle: () => void;
  icon: LucideIcon;
  label: string;
  title: string;
}

export function ToggleButton({ active, onToggle, icon: Icon, label, title }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all select-none whitespace-nowrap ${
        active
          ? "bg-accent/20 text-accent border border-accent/40 shadow-[0_0_6px_rgba(var(--accent-rgb),0.15)]"
          : "text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
