import { useMobile } from "../../hooks/useMobile";

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
  const mobile = useMobile();
  if (mobile && tabs.length > 4) return (
    <label className="section-picker flex items-center gap-3 shrink-0 border border-border rounded-xl bg-surface px-3">
      <span className="text-xs text-text-secondary">Seção</span>
      <select aria-label="Seção da página" value={active} onChange={(e) => onChange(e.target.value as K)} className="min-w-0 flex-1 bg-surface text-text-primary py-2 outline-none">
        {tabs.map((t) => <option key={t.key} value={t.key}>{t.label === "Terminal" ? "Conversa" : t.label}{t.badge ? ` (${t.badge})` : ""}</option>)}
      </select>
    </label>
  );
  return (
    <div className="page-tabs flex gap-1 border-b border-border overflow-x-auto scrollbar-none shrink-0 min-w-0" role="tablist" aria-label="Seções da página">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-sm border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            active === t.key
              ? "border-accent text-accent"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
        >
          {mobile && t.label === "Terminal" ? "Conversa" : t.label}
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
