import { useState } from "react";
import { CalendarClock, Play, Trash2, Clock } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { useToast } from "../shared/Toast";
import type { ScheduleEntry } from "../../lib/types";

interface AgentSchedulesProps {
  agentName: string;
  schedules: ScheduleEntry[];
  onRefresh: () => void;
}

function formatCreatedAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AgentSchedules({ agentName, schedules, onRefresh }: AgentSchedulesProps) {
  const { addToast } = useToast();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRemove = async (s: ScheduleEntry) => {
    if (!confirm(`Remover o agendamento "${s.task}"?`)) return;
    setRemovingId(s.id);
    try {
      await api.delete(`/agents/${agentName}/schedules/${s.id}`);
      addToast("success", "Agendamento removido");
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao remover");
    } finally {
      setRemovingId(null);
    }
  };

  const handleRunNow = async (s: ScheduleEntry) => {
    setRunningId(s.id);
    try {
      await api.post("/executions", {
        targetType: "agent",
        targetName: agentName,
        prompt: s.task,
      });
      addToast("success", "Tarefa iniciada agora");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao iniciar");
    } finally {
      setRunningId(null);
    }
  };

  if (schedules.length === 0) {
    return (
      <Card className="py-10 px-4 text-center">
        <CalendarClock size={28} className="mx-auto mb-3 text-text-muted" />
        <p className="text-sm text-text-secondary">Nenhuma tarefa agendada.</p>
        <p className="text-xs text-text-muted mt-1">
          Ative o modo <span className="text-accent font-medium">Scheduler</span> no Terminal e peça ao agente para criar uma tarefa recorrente.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        Tarefas que este agente executa automaticamente. Os agendamentos são criados pelo próprio agente — aqui você apenas visualiza e remove.
      </p>
      {schedules.map((s) => (
        <Card key={s.id} className="py-3 px-4">
          <div className="flex items-start gap-3">
            <CalendarClock size={18} className="text-accent mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Clock size={13} className="text-text-muted" />
                <span className="text-sm font-medium text-text-primary">{s.cronHuman || s.cron}</span>
                <Badge>{s.cron}</Badge>
              </div>
              <p className="text-sm text-text-secondary break-words">{s.task}</p>
              {s.createdAt && (
                <p className="text-[11px] text-text-muted mt-1">Criado em {formatCreatedAt(s.createdAt)}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleRunNow(s)}
                disabled={runningId === s.id}
              >
                <Play size={12} className="mr-1" /> Rodar agora
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleRemove(s)}
                disabled={removingId === s.id}
              >
                <Trash2 size={12} className="mr-1" /> {removingId === s.id ? "Removendo..." : "Remover"}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
