import { useEffect, useState } from "react";
import { Copy, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import type { CodexLoginState } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

const POLL_MS = 3000;

export function CodexLoginModal({ open, onClose, onDone }: Props) {
  const [state, setState] = useState<CodexLoginState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "code" | null>(null);

  const reset = () => {
    setState(null); setError(null); setCopied(null);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.post<CodexLoginState>("/system/codex-login/start")
      .then((s) => { if (!cancelled) setState(s); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao iniciar o login"); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !state || state.status !== "pending") return;
    const timer = setInterval(() => {
      api.get<CodexLoginState>("/system/codex-login/state").then((s) => {
        setState(s);
        if (s.status === "done") {
          onDone?.();
          setTimeout(() => { reset(); onClose(); }, 1200);
        }
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, state, onDone, onClose]);

  const copy = async (kind: "url" | "code", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard indisponível */ }
  };

  const cancel = async () => {
    await api.post("/system/codex-login/cancel").catch(() => {});
    reset();
    onClose();
  };

  const url = state?.url ?? "";
  const code = state?.code ?? "";
  const failure = error ?? (state?.status === "error" ? state.error : null);

  return (
    <Modal open={open} onClose={cancel} title="Conectar conta ChatGPT (Codex)" size="lg">
      {state?.status === "done" ? (
        <div className="flex items-center gap-2 text-success text-sm py-4">
          <CheckCircle2 size={18} /> Conectado. As próximas execuções com perfil OpenAI já usam a assinatura.
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <ol className="space-y-3 list-decimal list-inside text-text-secondary">
            <li>
              Abra esta URL no seu navegador e faça login na sua conta ChatGPT:
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  readOnly
                  value={url || (failure ? "" : "Gerando código...")}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => copy("url", url)}
                  disabled={!url}
                  title="Copiar"
                  className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  {copied === "url" ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
                </button>
                <a
                  href={url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir"
                  className={`p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 ${url ? "" : "pointer-events-none opacity-40"}`}
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </li>
            <li>
              Digite este código único (expira em 15 minutos):
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  readOnly
                  value={code}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-1.5 text-base font-mono tracking-widest text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => copy("code", code)}
                  disabled={!code}
                  title="Copiar"
                  className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  {copied === "code" ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              </div>
            </li>
          </ol>

          {failure
            ? <p className="text-xs text-danger break-words">{failure}</p>
            : (
              <p className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={12} className="animate-spin" /> Aguardando a confirmação no navegador...
              </p>
            )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={cancel}>Cancelar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
