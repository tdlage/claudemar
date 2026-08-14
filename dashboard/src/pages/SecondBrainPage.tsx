import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Brain } from "lucide-react";
import { Tabs } from "../components/shared/Tabs";
import { useBrainStatus } from "../hooks/useBrain";
import { OverviewTab } from "../components/brain/OverviewTab";
import { RawTab } from "../components/brain/RawTab";
import { WikiTab } from "../components/brain/WikiTab";
import { StateTab } from "../components/brain/StateTab";
import { BrainSettingsTab } from "../components/brain/BrainSettingsTab";
import { LogTab } from "../components/brain/LogTab";
import { SearchTab } from "../components/brain/SearchTab";
import { ChatTab } from "../components/brain/ChatTab";

type TabKey = "overview" | "chat" | "raw" | "wiki" | "search" | "state" | "settings" | "log";

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Visão geral",
  chat: "Conversar",
  raw: "Dados brutos",
  wiki: "Wiki",
  search: "Busca",
  state: "Estado",
  settings: "Configurações",
  log: "Log",
};

const TAB_KEYS = Object.keys(TAB_LABELS) as TabKey[];

export function SecondBrainPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab = (params.tab ?? "overview") as string;
  const splat = params["*"] ?? "";
  const { status } = useBrainStatus();

  if (!TAB_KEYS.includes(tab as TabKey)) {
    return <Navigate to="/second-brain" replace />;
  }
  const active = tab as TabKey;

  const tabs = TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    badge: key === "state" ? status?.quarantineCount : undefined,
    badgeVariant: "warning" as const,
  }));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Brain size={20} className="text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Second Brain</h1>
        {status && (
          <span
            className={`w-2 h-2 rounded-full ${status.redis.reachable ? "bg-success" : "bg-danger"}`}
            title={status.redis.reachable ? "Redis ok" : `Redis inacessível ${status.redis.lastError}`}
          />
        )}
      </div>
      <Tabs tabs={tabs} active={active} onChange={(key) => navigate(`/second-brain/${key === "overview" ? "" : key}`)} />
      {active === "overview" && <OverviewTab />}
      {active === "chat" && <ChatTab />}
      {active === "raw" && <RawTab splat={splat} />}
      {active === "wiki" && <WikiTab splat={splat} />}
      {active === "search" && <SearchTab />}
      {active === "state" && <StateTab splat={splat} />}
      {active === "settings" && <BrainSettingsTab />}
      {active === "log" && <LogTab />}
    </div>
  );
}
