import { useId, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";

export interface ConfidentialFile {
  id: string;
  instruction: string;
}

export function ConfidentialAttachment({ base, attachment, onChange, disabled = false }: {
  base: string;
  attachment: ConfidentialFile | null;
  onChange: (file: ConfidentialFile | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();
  const close = () => { if (!busy) { setOpen(false); setContent(""); setError(""); } };

  async function attach() {
    if (busy || !content.trim()) return;
    if (new TextEncoder().encode(content).length > 64 * 1024) {
      setError("O conteúdo deve ter no máximo 64 KB."); return;
    }
    setBusy(true);
    setError("");
    try {
      const file = await api.post<ConfidentialFile>("/confidential-attachments", { base, content });
      onChange(file);
      setContent("");
      setOpen(false);
    } catch {
      setError("Não foi possível anexar o arquivo. Tente novamente.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (busy || !attachment) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/confidential-attachments/${attachment.id}?base=${encodeURIComponent(base)}`);
      onChange(null);
      setOpen(false);
    } catch {
      setError("Não foi possível remover o arquivo. Tente novamente.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" disabled={disabled} onClick={() => { setError(""); setOpen(true); }}
        aria-label={attachment ? "Arquivo confidencial anexado" : "Anexar senha ou chave"}
        title={attachment ? "Arquivo confidencial anexado" : "Anexar senha ou chave"}
        className={`composer-confidential flex items-center justify-center h-11 w-11 md:h-auto md:w-auto shrink-0 p-1.5 rounded-xl transition-colors ${attachment ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"}`}>
        <LockKeyhole size={18} aria-hidden="true" />
        {attachment && <span className="sr-only">Pronto para enviar com a mensagem</span>}
      </button>
      <Modal open={open} onClose={close} dismissible={!busy} title="Arquivo confidencial">
        <div className="space-y-4">
          {attachment ? (
            <>
              <p className="text-sm text-text-primary flex items-center gap-2"><LockKeyhole size={18} />Arquivo anexado à próxima mensagem.</p>
              <p className="text-sm text-text-secondary">O conteúdo fica oculto no compositor. Clique em Enviar mensagem para disponibilizar o arquivo ao agente.</p>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void remove()}><X size={14} />Remover arquivo</Button>
                <Button disabled={busy} onClick={close}>Concluir</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">Cole senhas, chaves ou credenciais. A mensagem receberá apenas a referência a um arquivo privado no servidor, sem colar estes valores na conversa.</p>
              <div className="space-y-2">
                <label htmlFor={fieldId} className="block text-sm text-text-primary">Conteúdo confidencial</label>
                <textarea id={fieldId} value={content} onChange={(event) => setContent(event.target.value)} disabled={busy}
                  rows={7} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  aria-describedby={`${fieldId}-help`} className="w-full resize-y rounded-md border border-border bg-bg p-3 text-sm text-text-primary focus:border-accent" />
                <p id={`${fieldId}-help`} className="text-xs text-text-muted">Até 64 KB. O agente e o provedor do modelo poderão acessar o conteúdo. O agente será orientado a não reproduzi-lo nas saídas.</p>
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button>
                <Button disabled={busy || !content.trim()} onClick={() => void attach()}>{busy ? "Anexando…" : "Anexar arquivo"}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
