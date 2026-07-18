import { useEffect, useState } from "react";
import { Copy, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export function ClaudeLoginModal({ open, onClose, onDone }: Props) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl(""); setCode(""); setError(null); setDone(false); setCopied(false);
      return;
    }
    setLoadingUrl(true);
    api.post<{ url: string }>("/system/claude-login/start")
      .then((r) => setUrl(r.url))
      .catch((e) => setError(e instanceof Error ? e.message : "Falha ao gerar a URL"))
      .finally(() => setLoadingUrl(false));
  }, [open]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard indisponível */ }
  };

  const complete = async () => {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.post("/system/claude-login/complete", { code: code.trim() });
      setDone(true);
      onDone?.();
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao concluir o login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Reconectar Claude (subscription)" size="lg">
      {done ? (
        <div className="flex items-center gap-2 text-success text-sm py-4">
          <CheckCircle2 size={18} /> Reconectado. As próximas execuções já usam a nova sessão.
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <ol className="space-y-3 list-decimal list-inside text-text-secondary">
            <li>
              Abra esta URL no seu navegador e faça login na sua conta Claude:
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  readOnly
                  value={loadingUrl ? "Gerando URL..." : url}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={copyUrl}
                  disabled={!url}
                  title="Copiar"
                  className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
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
            <li>Depois de autorizar, copie o <strong>código</strong> exibido e cole abaixo:</li>
          </ol>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Cole aqui o código (ex.: abc123... ou abc123#estado)"
            rows={2}
            className="w-full bg-bg border border-border rounded p-2 text-xs font-mono focus:outline-none focus:border-accent"
          />

          {error && <p className="text-xs text-danger break-words">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button size="sm" variant="primary" disabled={busy || !code.trim()} onClick={complete}>
              {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              Concluir
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
