import { useEffect, useState, useCallback } from "react";
import { UserCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { CodexLoginModal } from "./CodexLoginModal";
import type { CodexAuthStatus } from "../../lib/types";

export function CodexAccountSection() {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((force = false) => {
    api.get<CodexAuthStatus>(`/system/codex-auth${force ? "?force=1" : ""}`).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connected = Boolean(status?.loggedIn) && status?.method === "chatgpt" && !status?.authError;

  const label = (): string => {
    if (status == null) return "Verificando...";
    if (status.authError) return "Erro de autenticação na última execução — reconecte.";
    if (!status.loggedIn) return "Sem login — conecte a assinatura do ChatGPT.";
    if (status.method === "api") return "Logado com API key — os modelos GPT devem usar a assinatura do ChatGPT. Reconecte.";
    return "Conectado à assinatura do ChatGPT";
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.post("/system/codex-logout");
      refresh(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
        <UserCircle size={14} className="text-text-muted" /> Conta OpenAI (ChatGPT)
      </h2>
      <p className="text-sm text-text-muted">
        Login do Codex usado pelos perfis com runtime Codex SDK (modelos GPT). A cota vem da assinatura do ChatGPT,
        nunca de API key. O login é por código: abra a URL no navegador, entre na conta e digite o código exibido.
      </p>

      <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-3">
        {connected
          ? <CheckCircle2 size={16} className="shrink-0 text-success" />
          : <AlertTriangle size={16} className="shrink-0 text-warning" />}
        <div className="flex-1 min-w-0 text-sm text-text-secondary">{label()}</div>
        {status?.loggedIn && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="shrink-0 px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-40"
          >
            Desconectar
          </button>
        )}
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          {connected ? "Reconectar" : "Conectar"}
        </button>
      </div>

      <CodexLoginModal open={open} onClose={() => setOpen(false)} onDone={() => refresh(true)} />
    </section>
  );
}
