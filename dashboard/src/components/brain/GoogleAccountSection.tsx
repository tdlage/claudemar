import { useState } from "react";
import { CheckCircle2, AlertTriangle, Plus } from "lucide-react";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import { useGoogleAccounts, useTenants } from "../../hooks/useBrain";

const selectClass =
  "bg-bg border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent";

export function GoogleAccountSection() {
  const { accounts, loading, connect, disconnect, updateAccount } = useGoogleAccounts();
  const { tenants } = useTenants();
  const { addToast } = useToast();
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    const result = await connect();
    if (!result.ok) addToast("error", result.error ?? "Falha ao iniciar autorização");
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    setBusy(true);
    try {
      await disconnect(disconnectTarget);
      addToast("success", `${disconnectTarget} desconectada`);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setDisconnectTarget(null);
    }
  };

  return (
    <div className="space-y-3">
      {loading && accounts.length === 0 && <p className="text-xs text-text-muted">Carregando…</p>}
      {!loading && accounts.length === 0 && (
        <p className="text-xs text-text-muted">
          Nenhuma conta conectada. Conecte a pessoal e uma por empresa — cada conta tem cursores e tenant próprios.
        </p>
      )}
      {accounts.map((account) => (
        <div key={account.email} className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
          {account.reauthRequired ? (
            <AlertTriangle size={14} className="text-danger shrink-0" />
          ) : account.connected ? (
            <CheckCircle2 size={14} className="text-success shrink-0" />
          ) : (
            <AlertTriangle size={14} className="text-warning shrink-0" />
          )}
          <span className="text-sm text-text-primary truncate flex-1">{account.email}</span>
          {account.reauthRequired && <Badge variant="danger">reautorizar</Badge>}
          <select
            value={account.tenant}
            onChange={async (e) => {
              try {
                await updateAccount(account.email, { tenant: e.target.value });
                addToast("success", `Tenant de ${account.email} atualizado`);
              } catch (err) {
                addToast("error", err instanceof Error ? err.message : String(err));
              }
            }}
            className={selectClass}
            title="Contexto padrão desta conta — a triagem ainda pode decidir outro pelo assunto"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {account.reauthRequired ? (
            <Button size="sm" variant="secondary" onClick={handleConnect}>
              Reconectar
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDisconnectTarget(account.email)}>
            Desconectar
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={handleConnect} className="flex items-center gap-1.5">
        <Plus size={14} />
        {accounts.length === 0 ? "Conectar Google" : "Conectar outra conta"}
      </Button>
      <Modal open={disconnectTarget !== null} onClose={() => setDisconnectTarget(null)} title="Desconectar conta">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Os conectores Gmail e Calendar de <strong>{disconnectTarget}</strong> vão parar de ingerir. Os dados já
            gravados em raw/ permanecem intactos.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDisconnectTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={handleDisconnect} disabled={busy}>
              Desconectar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
