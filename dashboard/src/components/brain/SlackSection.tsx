import { useCallback, useEffect, useRef, useState } from "react";
import { Hash, Plus, Copy, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api";
import { isAdmin } from "../../hooks/useAuth";
import { useSocketEvent } from "../../hooks/useSocket";
import { useBrainRoom } from "../../hooks/useBrain";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type { BrainSlackAccount, BrainSlackStatus } from "../../lib/types";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 5 * 60_000;

export function SlackSection() {
  useBrainRoom();
  const { addToast } = useToast();
  const admin = isAdmin();
  const [status, setStatus] = useState<BrainSlackStatus | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<BrainSlackAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api.get<BrainSlackStatus>("/brain/slack/status").then(setStatus).catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    refresh();
    return stopPolling;
  }, [refresh, stopPolling]);

  useSocketEvent("brain:slack", () => refresh());

  const connect = async () => {
    try {
      const { authUrl } = await api.post<{ authUrl: string }>("/brain/slack/start", {});
      const popup = window.open(authUrl, "brain-slack", "width=600,height=760");
      if (!popup) window.open(authUrl, "_blank");
      stopPolling();
      const startedAt = Date.now();
      pollTimer.current = setInterval(() => {
        refresh();
        if (Date.now() - startedAt > POLL_LIMIT_MS || (popup && popup.closed)) stopPolling();
      }, POLL_MS);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget) return;
    setBusy(true);
    try {
      const res = await api.post<{ accounts: BrainSlackAccount[] }>("/brain/slack/disconnect", {
        teamId: disconnectTarget.teamId,
        userId: disconnectTarget.userId,
      });
      setStatus((prev) => (prev ? { ...prev, accounts: res.accounts } : prev));
      addToast("success", `${disconnectTarget.teamName} desconectado`);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setDisconnectTarget(null);
    }
  };

  const accounts = status?.accounts ?? [];

  return (
    <div className="bg-bg border border-border rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Hash size={15} className="text-text-muted" />
        <span className="text-sm font-medium text-text-primary flex-1">Slack</span>
        {status?.configured && accounts.length > 0 && (
          <Badge variant={status.socketConnected ? "success" : "warning"}>
            {status.socketConnected ? "tempo real ativo" : "sem tempo real"}
          </Badge>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Conecte a sua conta do Slack: o brain recebe as mensagens dos canais, grupos e DMs que você enxerga no workspace
        — e só elas. Cada usuário autoriza a própria conta no mesmo app.
      </p>
      {status && !status.configured && (
        <p className="text-xs text-warning">
          {admin
            ? "Configure SLACK_CLIENT_ID, SLACK_CLIENT_SECRET e SLACK_APP_TOKEN em Settings → Variáveis de ambiente."
            : "O administrador ainda não configurou o app do Slack."}
        </p>
      )}
      {admin && status && (
        <div className="bg-surface border border-border rounded-md px-3 py-2 space-y-1">
          <p className="text-xs text-text-muted">
            No app do Slack: Redirect URL abaixo, escopos de usuário channels:history, groups:history, im:history,
            mpim:history, channels:read, groups:read, im:read, mpim:read e users:read; Socket Mode ligado com um app-level
            token (connections:write e authorizations:read); e os eventos de usuário message.channels, message.groups,
            message.im e message.mpim.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-text-primary font-mono truncate flex-1">{status.redirectUri}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(status.redirectUri);
                addToast("success", "Redirect URL copiada");
              }}
              className="text-text-muted hover:text-accent transition-colors shrink-0"
              title="Copiar"
            >
              <Copy size={14} />
            </button>
          </div>
          {status.lastError && <p className="text-xs text-danger">{status.lastError}</p>}
        </div>
      )}
      {accounts.map((account) => (
        <div key={`${account.teamId}:${account.userId}`} className="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2">
          {account.reauthRequired ? (
            <AlertTriangle size={14} className="text-danger shrink-0" />
          ) : (
            <CheckCircle2 size={14} className="text-success shrink-0" />
          )}
          <span className="text-sm text-text-primary truncate flex-1">
            {account.teamName} <span className="text-text-muted">· {account.userName}</span>
          </span>
          {account.reauthRequired && <Badge variant="danger">reconectar</Badge>}
          {account.reauthRequired && (
            <Button size="sm" variant="secondary" onClick={connect}>
              Reconectar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDisconnectTarget(account)}>
            Desconectar
          </Button>
        </div>
      ))}
      {status?.configured && (
        <Button size="sm" variant="secondary" onClick={connect} className="flex items-center gap-1.5">
          <Plus size={14} />
          {accounts.length === 0 ? "Conectar Slack" : "Conectar outro workspace"}
        </Button>
      )}

      <Modal open={disconnectTarget !== null} onClose={() => setDisconnectTarget(null)} title="Desconectar Slack">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            A autorização de <strong>{disconnectTarget?.userName}</strong> em <strong>{disconnectTarget?.teamName}</strong>{" "}
            é revogada e as mensagens novas param de chegar ao seu brain. O que já foi gravado permanece.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDisconnectTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={disconnect} disabled={busy}>
              Desconectar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
