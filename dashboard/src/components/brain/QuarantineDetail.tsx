import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import { api } from "../../lib/api";
import { useBrainData } from "../../hooks/useBrain";
import { QUARANTINE_KIND_META } from "./QuarantineList";
import type { BrainQuarantineItem } from "../../lib/types";

export function QuarantineDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: item, loading, error } = useBrainData<BrainQuarantineItem>(
    `/brain/quarantine/${encodeURIComponent(id)}`,
  );

  if (loading) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  if (error || !item) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-danger">{error ?? "Item não encontrado"}</p>
        <button onClick={() => navigate("/second-brain/state")} className="text-sm text-accent hover:underline">
          Voltar
        </button>
      </div>
    );
  }

  const meta = QUARANTINE_KIND_META[item.kind];
  const retryable = Boolean(item.threadKey);

  const retry = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ requeued: string }>(`/brain/quarantine/${item.id}/retry`, {});
      addToast("success", `Reprocessamento enfileirado (${res.requeued})`);
      navigate("/second-brain/state");
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api.post(`/brain/quarantine/${item.id}/discard`, {});
      addToast("success", "Item descartado");
      navigate("/second-brain/state");
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("/second-brain/state")}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Voltar"
        >
          <ArrowLeft size={16} />
        </button>
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span className="text-xs text-text-muted">{format(new Date(item.ts), "dd/MM/yyyy HH:mm")}</span>
        <div className="flex-1" />
        {retryable && (
          <Button size="sm" onClick={retry} disabled={busy}>
            Reprocessar
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => setConfirmDiscard(true)} disabled={busy}>
          Descartar
        </Button>
      </div>
      <Card className="space-y-3">
        <p className="text-sm text-text-primary">{item.error}</p>
        {item.threadKey && (
          <p className="text-xs text-text-muted font-mono">thread: {item.threadKey}</p>
        )}
        {item.payload != null && (
          <pre className="font-mono text-xs bg-bg border border-border rounded-md p-3 overflow-x-auto max-h-96 text-text-secondary">
            {JSON.stringify(item.payload, null, 2)}
          </pre>
        )}
      </Card>
      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Descartar item">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Descartar definitivamente esta operação? O compilador nunca a aplicará.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={discard} disabled={busy}>
              Descartar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
