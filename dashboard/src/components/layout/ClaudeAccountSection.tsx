import { useEffect, useState, useCallback } from "react";
import { UserCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { ClaudeLoginModal } from "./ClaudeLoginModal";

interface AuthStatus {
  present: boolean;
  expiresAt: number | null;
  expired: boolean;
  authError: { at: number; message: string } | null;
}

export function ClaudeAccountSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    api.get<AuthStatus>("/system/claude-auth").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connected = Boolean(status?.present) && !status?.authError;

  const label = (): string => {
    if (status == null) return "Verificando...";
    if (status.authError) return "Erro de autenticação na última execução — reconecte.";
    if (!status.present) return "Sem credencial — conecte a subscription.";
    if (status.expiresAt) return `Conectado · token expira em ${new Date(status.expiresAt).toLocaleString()}`;
    return "Conectado";
  };

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
        <UserCircle size={14} className="text-text-muted" /> Conta Claude (subscription)
      </h2>
      <p className="text-sm text-text-muted">
        Autenticação OAuth usada pelas execuções nativas (perfil com Base URL vazia). Se o Claude retornar 401, reconecte aqui:
        abra a URL no navegador, autorize e cole o código de volta. Não depende de nenhuma execução de IA.
      </p>

      <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-3">
        {connected
          ? <CheckCircle2 size={16} className="shrink-0 text-success" />
          : <AlertTriangle size={16} className="shrink-0 text-warning" />}
        <div className="flex-1 min-w-0 text-sm text-text-secondary">{label()}</div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          Reconectar
        </button>
      </div>

      <ClaudeLoginModal open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </section>
  );
}
