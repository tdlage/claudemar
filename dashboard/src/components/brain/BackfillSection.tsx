import { useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import { useBrainStatus, useGoogleAccounts } from "../../hooks/useBrain";
import { BackfillProgressCard } from "./BackfillProgressCard";

interface BackfillEstimate {
  untriaged: number;
  compilable: number;
  estimatedCostUsd: number;
  triageBatch: boolean;
  compileBatch: boolean;
}

const inputClass =
  "w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent";

export function BackfillSection() {
  const { status, refresh } = useBrainStatus();
  const { accounts } = useGoogleAccounts();
  const { addToast } = useToast();
  const [monthsRaw, setMonthsRaw] = useState(12);
  const [monthsCompile, setMonthsCompile] = useState(3);
  const [selected, setSelected] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<BackfillEstimate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const connected = accounts.filter((a) => a.connected);
  const backfill = status?.backfill;

  const openConfirm = async () => {
    setBusy(true);
    try {
      const est = await api.get<BackfillEstimate>(`/brain/backfill/estimate?monthsCompile=${monthsCompile}`);
      setEstimate(est);
      setConfirming(true);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      await api.post("/brain/backfill/start", {
        monthsRaw,
        monthsCompile,
        accounts: selected.length > 0 ? selected : undefined,
      });
      addToast("success", "Backfill iniciado");
      setConfirming(false);
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (backfill && backfill.status === "running") {
    return <BackfillProgressCard backfill={backfill} />;
  }

  return (
    <div className="space-y-3">
      {backfill && backfill.status !== "idle" && <BackfillProgressCard backfill={backfill} />}
      <p className="text-xs text-text-muted">
        Ingere o histórico (raw), roda a triagem e compila os últimos meses. Retomável: cancelar preserva o
        progresso por mês/conta.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Meses de histórico bruto (raw)</label>
          <input
            type="number"
            min={1}
            max={36}
            value={monthsRaw}
            onChange={(e) => setMonthsRaw(Math.max(1, Number(e.target.value) || 1))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Meses a compilar</label>
          <input
            type="number"
            min={1}
            max={36}
            value={monthsCompile}
            onChange={(e) => setMonthsCompile(Math.max(1, Number(e.target.value) || 1))}
            className={inputClass}
          />
        </div>
      </div>
      {connected.length > 1 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-text-muted">Contas (nenhuma marcada = todas)</p>
          <div className="flex flex-wrap gap-3">
            {connected.map((account) => (
              <label key={account.email} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(account.email)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, account.email] : prev.filter((a) => a !== account.email),
                    )
                  }
                />
                {account.email}
              </label>
            ))}
          </div>
        </div>
      )}
      <Button
        size="sm"
        onClick={openConfirm}
        disabled={busy || connected.length === 0}
        className="flex items-center gap-1.5"
      >
        <DatabaseBackup size={14} />
        {busy ? "Calculando…" : "Iniciar backfill"}
      </Button>
      {connected.length === 0 && (
        <p className="text-xs text-warning">Conecte pelo menos uma conta Google antes de rodar o backfill.</p>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Confirmar backfill">
        <div className="space-y-4">
          {estimate && (
            <div className="text-sm text-text-secondary space-y-1.5">
              <p>
                Já em raw/: <strong>{estimate.untriaged}</strong> thread(s) sem triagem e{" "}
                <strong>{estimate.compilable}</strong> candidata(s) a compilação — custo estimado dessas etapas:{" "}
                <strong>${estimate.estimatedCostUsd.toFixed(2)}</strong>
                {estimate.triageBatch || estimate.compileBatch ? " (com Batch API)" : " (sem Batch API — realtime)"}.
              </p>
              <p className="text-xs text-text-muted">
                A fase raw ainda vai baixar o histórico do Gmail/Calendar ({monthsRaw} meses), então o total de
                threads cresce durante a execução. Referência da spec: triagem de 12 meses ≈ $15; compilação
                integral dos últimos 3 meses ≈ $80–150 em batch. Compilar 12 meses inteiros custaria $600+.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={start} disabled={busy}>
              {busy ? "Iniciando…" : "Iniciar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
