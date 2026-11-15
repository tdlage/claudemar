import { useCallback, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useSocketEvent } from "../../hooks/useSocket";
import { useToast } from "../shared/Toast";
import type { Unavailable } from "./controller";
import { DecantaGame } from "./DecantaGame";

interface Props {
  executionId: string | null;
  live: boolean;
  awaitingInput: boolean;
  activity?: string;
}

export function GameLauncher({ executionId, live, awaitingInput, activity }: Props) {
  const { addToast } = useToast();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [questionFor, setQuestionFor] = useState<string | null>(null);

  useSocketEvent<{ id: string }>("execution:question", ({ id }) => {
    if (id === executionId) setQuestionFor(id);
  });
  useSocketEvent<{ id: string }>("execution:question:answered", ({ id }) => {
    setQuestionFor((current) => (current === id ? null : current));
  });

  const playing = executionId !== null && openFor === executionId;
  const endedWhilePlaying = playing && !live;

  useEffect(() => {
    if (endedWhilePlaying) addToast("info", "A execução terminou. Seu progresso no Decanta está salvo para o próximo prompt.");
  }, [endedWhilePlaying, addToast]);

  const handleUnavailable = useCallback((reason: Unavailable) => {
    if (reason === "awaiting-input") {
      setQuestionFor(executionId);
      return;
    }
    setOpenFor(null);
    addToast("info", "O jogo fica disponível apenas enquanto um prompt está em execução.");
  }, [executionId, addToast]);

  if (!live || executionId === null) return null;

  if (!playing) {
    return (
      <button
        type="button"
        className="game-launcher"
        onClick={() => setOpenFor(executionId)}
        aria-label="Jogar Decanta enquanto a execução continua"
        title="Jogar enquanto espera"
      >
        <FlaskConical size={15} aria-hidden="true" />
        <span className="game-launcher-label">Jogar enquanto espera</span>
      </button>
    );
  }

  return (
    <DecantaGame
      key={executionId}
      execId={executionId}
      hidden={awaitingInput || questionFor === executionId}
      activity={activity}
      onClose={() => setOpenFor(null)}
      onUnavailable={handleUnavailable}
    />
  );
}
