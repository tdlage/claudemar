import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Brain } from "lucide-react";
import { Tabs } from "../components/shared/Tabs";
import { useBrainStatus } from "../hooks/useBrain";
import { isAdmin } from "../hooks/useAuth";
import { OverviewTab } from "../components/brain/OverviewTab";
import { RawTab } from "../components/brain/RawTab";
import { WikiTab } from "../components/brain/WikiTab";
import { StateTab } from "../components/brain/StateTab";
import { BrainSettingsTab } from "../components/brain/BrainSettingsTab";
import { LogTab } from "../components/brain/LogTab";
import { SearchTab } from "../components/brain/SearchTab";
import { ChatTab } from "../components/brain/ChatTab";
import { BrainOwnerSelect } from "../components/brain/BrainOwnerSelect";
import { ObservedBrainView } from "../components/brain/ObservedBrainView";

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
const OBSERVE_SEGMENT = "usuarios";

export function SecondBrainPage() {
  const params = useParams();
  const tab = params.tab ?? "overview";
  const splat = params["*"] ?? "";
  const admin = isAdmin();

  if (tab === OBSERVE_SEGMENT) {
    if (!admin || !splat) return <Navigate to="/second-brain" replace />;
    return <ObservedBrainPage owner={splat} />;
  }
  if (!TAB_KEYS.includes(tab as TabKey)) {
    return <Navigate to="/second-brain" replace />;
  }
  return <OwnBrainPage active={tab as TabKey} splat={splat} admin={admin} />;
}

function PageHeader({ admin, owner, children }: { admin: boolean; owner: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Brain size={20} className="text-text-muted" />
      <h1 className="text-lg font-semibold text-text-primary">Second Brain</h1>
      {children}
      {admin && (
        <div className="ml-auto">
          <BrainOwnerSelect current={owner} />
        </div>
      )}
    </div>
  );
}

function OwnBrainPage({ active, splat, admin }: { active: TabKey; splat: string; admin: boolean }) {
  const navigate = useNavigate();
  const { status } = useBrainStatus();

  const tabs = TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    badge: key === "state" ? status?.quarantineCount : key === "settings" ? status?.connections.length : undefined,
    badgeVariant: "warning" as const,
  }));

  return (
    <div className={`brain-page ${active === "chat" ? "is-chat" : ""} p-4 md:p-6 max-w-6xl mx-auto space-y-4`}>
      <PageHeader admin={admin} owner="admin">
        {status && (
          <span
            className={`w-2 h-2 rounded-full ${status.redis.reachable ? "bg-success" : "bg-danger"}`}
            title={status.redis.reachable ? "Redis ok" : `Redis inacessível ${status.redis.lastError}`}
          />
        )}
      </PageHeader>
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

function ObservedBrainPage({ owner }: { owner: string }) {
  return (
    <div className="brain-page p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader admin owner={owner} />
      <ObservedBrainView key={owner} owner={owner} />
    </div>
  );
}
