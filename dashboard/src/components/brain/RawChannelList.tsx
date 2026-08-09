import { useNavigate } from "react-router-dom";
import { Mail, Calendar, MessageCircle, Hash, HardDrive } from "lucide-react";
import { Card } from "../shared/Card";
import { useBrainData } from "../../hooks/useBrain";
import type { BrainChannelSummary } from "../../lib/types";

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: "Email", icon: Mail },
  calendar: { label: "Agenda", icon: Calendar },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  slack: { label: "Slack", icon: Hash },
};

const IDLE_HINT: Record<string, string> = {
  whatsapp: "conector disponível — pareie o número em Configurações",
  slack: "conector disponível — ligue o agendador em Configurações",
};

export function RawChannelList() {
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useBrainData<BrainChannelSummary[]>("/brain/raw/channels");

  if (loading) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  if (error) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-danger">{error}</p>
        <button onClick={refresh} className="text-sm text-accent hover:underline">Tentar novamente</button>
      </div>
    );
  }

  const channels = data ?? [];
  if (channels.length === 0) {
    return (
      <p className="text-sm text-text-muted py-8 text-center">
        Nenhum dado ingerido ainda. Conecte uma conta Google em Configurações para começar.
      </p>
    );
  }

  const missing = Object.keys(IDLE_HINT).filter((c) => !channels.some((ch) => ch.channel === c));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {channels.map((channel) => {
        const meta = CHANNEL_META[channel.channel] ?? { label: channel.channel, icon: HardDrive };
        const Icon = meta.icon;
        return (
          <Card key={channel.channel} onClick={() => navigate(`/second-brain/raw/${channel.channel}`)}>
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className="text-accent" />
              <span className="text-sm font-medium text-text-primary">{meta.label}</span>
            </div>
            <p className="text-xs text-text-muted">
              {channel.threads} conversa(s) · {channel.firstAt ?? "—"} a {channel.lastAt ?? "—"}
            </p>
          </Card>
        );
      })}
      {missing.map((name) => {
        const meta = CHANNEL_META[name];
        const Icon = meta.icon;
        return (
          <Card key={name} className="opacity-50">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className="text-text-muted" />
              <span className="text-sm font-medium text-text-secondary">{meta.label}</span>
            </div>
            <p className="text-xs text-text-muted">sem dados ainda — {IDLE_HINT[name]}</p>
          </Card>
        );
      })}
    </div>
  );
}
