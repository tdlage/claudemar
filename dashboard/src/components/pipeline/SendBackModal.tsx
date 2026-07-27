import { useState } from "react";
import { Undo2 } from "lucide-react";
import type { PipelineCard } from "../../lib/types";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";

interface Props {
  card: PipelineCard;
  onClose: () => void;
}

export function SendBackModal({ card, onClose }: Props) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/pipeline/cards/${card.id}/send-back`, { feedback });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao devolver card");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Devolver #${card.seqNumber} p/ implementação`}>
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          O card volta para a Implementação e o fluxo recomeça dali tratando <strong>apenas este ajuste</strong> sobre o que já foi desenvolvido — nada é refeito do zero.
        </p>
        <textarea
          autoFocus
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="O que precisa ser alterado no desenvolvimento?"
          className="w-full h-28 bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button size="sm" variant="primary" disabled={busy || !feedback.trim()} onClick={submit}>
            <Undo2 size={14} className="mr-1" /> Devolver e reabrir implementação
          </Button>
        </div>
      </div>
    </Modal>
  );
}
