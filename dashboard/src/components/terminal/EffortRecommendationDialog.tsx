import type { AgentRuntime } from "../../lib/types";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import type { ComplexityAssessment } from "./complexity";
import { effortLabel, type Effort } from "./effortOptions";

export interface EffortRecommendation {
  assessment: ComplexityAssessment;
  selected: Effort;
  runtime: AgentRuntime;
}

interface EffortRecommendationDialogProps {
  recommendation: EffortRecommendation | null;
  onChoose: (effort: Effort | null) => void;
}

export function EffortRecommendationDialog({ recommendation, onChoose }: EffortRecommendationDialogProps) {
  if (!recommendation) return null;
  const { assessment, selected, runtime } = recommendation;
  const recommended = effortLabel(runtime, assessment.effort);
  const current = effortLabel(runtime, selected);

  return (
    <Modal open onClose={() => onChoose(null)} title="Esforço recomendado">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          O Jev avaliou este prompt com complexidade <strong className="text-text-primary">{assessment.complexity}/5</strong>{" "}
          (confiança de {Math.round(assessment.confidence * 100)}%) e recomenda o esforço <strong className="text-text-primary">{recommended}</strong>.
          O esforço selecionado é <strong className="text-text-primary">{current}</strong>.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onChoose(selected)}>Manter {current}</Button>
          <Button onClick={() => onChoose(assessment.effort)}>Usar {recommended}</Button>
        </div>
      </div>
    </Modal>
  );
}
