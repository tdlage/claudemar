import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Loader2, Plug, RefreshCw, Trash2, Unplug } from "lucide-react";
import { api } from "../../lib/api";
import { listenIntegrationAuthorization, openIntegrationAuthorization } from "../../lib/integrationAuth";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type { AgentIntegration, AgentIntegrationsResponse, IntegrationAccount, IntegrationProviderId, IntegrationProviderInfo } from "../../lib/types";

interface AgentIntegrationsProps {
  agentName: string;
  onChanged: () => void;
}

const SETUP_STEPS: Record<IntegrationProviderId, string> = {
  asana: "Crie um app do tipo \"MCP app\" em app.asana.com/0/my-apps, cadastre o Redirect URL abaixo na aba OAuth do app e libere a distribuição em Manage distribution (\"Any workspace\" ou os workspaces permitidos).",
  notion: "O Notion não exige app próprio: o Claudemar se registra automaticamente no servidor MCP do Notion.",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function accountLabel(name: string, detail: string | null): string {
  return detail ? `${name} (${detail})` : name;
}

function SetupInstructions({ provider }: { provider: IntegrationProviderInfo }) {
  const { addToast } = useToast();
  if (!provider.redirectUri) return <p className="text-sm text-text-muted">O {provider.label} não está configurado neste servidor. Peça a um admin para configurá-lo.</p>;
  return (
    <div className="space-y-2 text-sm text-text-secondary">
      <p>O {provider.label} não está configurado neste servidor.</p>
      <p className="text-xs text-text-muted">
        {SETUP_STEPS[provider.id]}
        {provider.envKeys && ` Depois defina ${provider.envKeys.join(" e ")} em Configurações → Chaves de API → Configurar chaves e reinicie o serviço.`}
      </p>
      <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
        <code className="text-xs text-text-primary font-mono truncate flex-1">{provider.redirectUri}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(provider.redirectUri ?? "");
            addToast("success", "Redirect URL copiado");
          }}
          className="text-text-muted hover:text-accent transition-colors shrink-0 cursor-pointer"
          title="Copiar"
          aria-label="Copiar redirect URL"
        >
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}

interface ProviderCardProps {
  provider: IntegrationProviderInfo;
  link: AgentIntegration | undefined;
  accounts: IntegrationAccount[];
  busy: boolean;
  onConnect: (accountId?: string) => void;
  onLink: (accountId: string) => void;
  onRemove: (link: AgentIntegration) => void;
}

function ProviderCard({ provider, link, accounts, busy, onConnect, onLink, onRemove }: ProviderCardProps) {
  const usable = accounts.filter((account) => !account.reauthRequired);
  const [selected, setSelected] = useState("");
  const chosen = usable.some((account) => account.id === selected) ? selected : usable[0]?.id ?? "";

  return (
    <Card className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <Plug size={14} className="text-text-muted" />
        <h3 className="text-sm font-medium">{provider.label}</h3>
        {link && (link.reauthRequired ? <Badge variant="warning">Reconexão necessária</Badge> : <Badge variant="success">Conectado</Badge>)}
        {!link && provider.configured && <Badge>Não conectado</Badge>}
        {link && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {link.isOwner && link.reauthRequired && link.accountId && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onConnect(link.accountId ?? undefined)}>
                <RefreshCw size={13} /> Reconectar
              </Button>
            )}
            {link.canManage && (
              <button
                type="button"
                onClick={() => onRemove(link)}
                disabled={busy}
                className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
                title="Remover do agente"
                aria-label={`Remover ${provider.label} do agente`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {link ? (
        <div className="space-y-1 text-xs text-text-muted">
          <p>
            <span className="text-text-primary">{accountLabel(link.accountName, link.accountDetail)}</span> · compartilhada por {link.ownerName}
          </p>
          {link.reauthRequired ? (
            <p className="text-amber-400">
              A autorização expirou ou foi revogada, então o agente está sem acesso ao {provider.label}.
              {link.isOwner ? " Clique em Reconectar." : ` Peça para ${link.ownerName} reconectar.`}
            </p>
          ) : (
            <p>O agente usa as ferramentas oficiais do {provider.label} (<span className="font-mono">mcp__{provider.id}__*</span>) em nome desta conta.</p>
          )}
        </div>
      ) : !provider.configured ? (
        <SetupInstructions provider={provider} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {usable.length > 0 && (
            <>
              <select
                aria-label={`Conta do ${provider.label}`}
                value={chosen}
                onChange={(event) => setSelected(event.target.value)}
                className="text-xs bg-transparent border border-border rounded-md px-1.5 py-1.5 text-text-primary focus:outline-none focus:border-accent max-w-64"
              >
                {usable.map((account) => (
                  <option key={account.id} value={account.id}>{accountLabel(account.name, account.detail)}</option>
                ))}
              </select>
              <Button size="sm" variant="secondary" disabled={busy || !chosen} onClick={() => onLink(chosen)}>
                <Link2 size={13} /> Vincular
              </Button>
              <span className="text-xs text-text-muted">ou</span>
            </>
          )}
          <Button size="sm" disabled={busy} onClick={() => onConnect()}>
            <Plug size={13} /> {usable.length > 0 ? "Conectar outra conta" : `Conectar ${provider.label}`}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AgentIntegrations({ agentName, onChanged }: AgentIntegrationsProps) {
  const { addToast } = useToast();
  const [state, setState] = useState<AgentIntegrationsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AgentIntegration | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<IntegrationAccount | null>(null);
  const basePath = `/agents/${agentName}/integrations`;

  const load = useCallback(() => {
    api.get<AgentIntegrationsResponse>(basePath)
      .then((data) => {
        setState(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, "Falha ao carregar as integrações")));
  }, [basePath]);

  const refreshAll = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);

  useEffect(load, [load]);

  useEffect(() => listenIntegrationAuthorization((event) => {
    if (event.type === "connected") addToast("success", event.message || "Conta conectada");
    else if (event.type === "error") addToast("error", event.message || "A autorização falhou");
    else return;
    refreshAll();
  }), [addToast, refreshAll]);

  const run = async (task: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      addToast("error", errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const connect = (provider: IntegrationProviderInfo, accountId?: string) => run(async () => {
    const mode = await openIntegrationAuthorization(agentName, provider.id, accountId);
    if (mode === "popup") addToast("info", `Autorize o acesso na janela do ${provider.label} para concluir`);
  }, "Falha ao iniciar a autorização");

  const link = (accountId: string) => run(async () => {
    await api.post<AgentIntegration>(basePath, { accountId });
    addToast("success", "Conta vinculada ao agente");
    refreshAll();
  }, "Falha ao vincular a conta");

  const remove = () => run(async () => {
    if (!removeTarget) return;
    await api.delete(`${basePath}/${removeTarget.id}`);
    addToast("success", "Integração removida do agente");
    setRemoveTarget(null);
    refreshAll();
  }, "Falha ao remover a integração");

  const disconnect = () => run(async () => {
    if (!disconnectTarget) return;
    await api.delete(`/integrations/accounts/${disconnectTarget.id}`);
    addToast("success", `${disconnectTarget.name} desconectado`);
    setDisconnectTarget(null);
    refreshAll();
  }, "Falha ao desconectar a conta");

  if (loadError && !state) return <p role="alert" className="text-sm text-red-400">{loadError}</p>;
  if (!state) return <div role="status" className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Carregando integrações…</div>;

  const providerLabel = (id: IntegrationProviderId) => state.providers.find((provider) => provider.id === id)?.label ?? id;

  return (
    <section className="space-y-4" aria-label="Integrações">
      <p className="text-sm text-text-muted">
        Conecte contas do Asana e do Notion para o agente usar as ferramentas oficiais de cada serviço. A conta vinculada vale para
        todas as conversas e agendamentos deste agente, inclusive quando outra pessoa usa o agente.
      </p>

      {state.providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          link={state.links.find((entry) => entry.provider === provider.id)}
          accounts={state.accounts.filter((account) => account.provider === provider.id)}
          busy={busy}
          onConnect={(accountId) => void connect(provider, accountId)}
          onLink={(accountId) => void link(accountId)}
          onRemove={setRemoveTarget}
        />
      ))}

      {state.accounts.length > 0 && (
        <section className="space-y-2" aria-label="Suas contas conectadas">
          <h3 className="text-sm font-medium">Suas contas conectadas</h3>
          <ul className="divide-y divide-border border border-border rounded-lg">
            {state.accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-2 px-3 py-2">
                <span className="text-xs text-text-muted w-14 shrink-0">{providerLabel(account.provider)}</span>
                <span className="text-xs text-text-primary truncate flex-1" title={accountLabel(account.name, account.detail)}>
                  {accountLabel(account.name, account.detail)}
                </span>
                {account.reauthRequired && <Badge variant="warning">Reconexão necessária</Badge>}
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {account.agentCount === 1 ? "1 agente" : `${account.agentCount} agentes`}
                </span>
                <button
                  type="button"
                  onClick={() => setDisconnectTarget(account)}
                  disabled={busy}
                  className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
                  title="Desconectar conta"
                  aria-label={`Desconectar ${account.name}`}
                >
                  <Unplug size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Remover integração" dismissible={!busy}>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Remover o {removeTarget ? providerLabel(removeTarget.provider) : ""} do agente <strong className="text-text-primary">{agentName}</strong>?
            O agente perde acesso às ferramentas dele. A conta continua conectada e pode ser vinculada de novo.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoveTarget(null)}>Cancelar</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? "Removendo…" : "Remover"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={disconnectTarget !== null} onClose={() => setDisconnectTarget(null)} title="Desconectar conta" dismissible={!busy}>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Desconectar <strong className="text-text-primary">{disconnectTarget?.name}</strong>? O acesso é revogado no{" "}
            {disconnectTarget ? providerLabel(disconnectTarget.provider) : ""} e a conta sai de todos os agentes em que está vinculada
            {disconnectTarget && disconnectTarget.agentCount > 0 ? ` (${disconnectTarget.agentCount})` : ""}.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDisconnectTarget(null)}>Cancelar</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void disconnect()}>{busy ? "Desconectando…" : "Desconectar"}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
