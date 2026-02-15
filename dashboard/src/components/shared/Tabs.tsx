interface Tab<K extends string> {
  key: K;
  label: string;
  badge?: number;
  badgeVariant?: "warning" | "default";
}

interface TabsProps<K extends string> {
  tabs: Tab<K>[];
  active: K;
  onChange: (key: K) => void;
}

const badgeColors = {
  default: "bg-accent/20 text-accent",
  warning: "bg-amber-500/20 text-amber-400",
};

export function Tabs<K extends string>({ tabs, active, onChange }: TabsProps<K>) {
  return (
    <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-none">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-sm border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            active === t.key
              ? "border-accent text-accent"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
        >
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${badgeColors[t.badgeVariant ?? "default"]}`}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
