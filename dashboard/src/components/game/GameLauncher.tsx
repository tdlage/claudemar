import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Languages } from "lucide-react";
import { getMe } from "../../hooks/useAuth";
import { useSocketEvent } from "../../hooks/useSocket";
import { useToast } from "../shared/Toast";
import { SpanishLesson } from "../spanish/SpanishLesson";
import type { Unavailable } from "./controller";
import { DecantaGame } from "./DecantaGame";

type Activity = "decanta" | "spanish";

const ENDED: Record<Activity, string> = {
  decanta: "A execução terminou. Seu progresso no Decanta está salvo para o próximo prompt.",
  spanish: "A execução terminou. Sua aula de espanhol está salva para o próximo prompt.",
};

const NOT_RUNNING: Record<Activity, string> = {
  decanta: "O jogo fica disponível apenas enquanto um prompt está em execução.",
  spanish: "A aula fica disponível apenas enquanto um prompt está em execução.",
};

interface Props {
  executionId: string | null;
  live: boolean;
  awaitingInput: boolean;
  activity?: string;
}

export function GameLauncher({ executionId, live, awaitingInput, activity }: Props) {
  const { addToast } = useToast();
  const admin = getMe()?.role === "admin";
  const [open, setOpen] = useState<{ execId: string; activity: Activity } | null>(null);
  const [questionFor, setQuestionFor] = useState<string | null>(null);

  useSocketEvent<{ id: string }>("execution:question", ({ id }) => {
    if (id === executionId) setQuestionFor(id);
  });
  useSocketEvent<{ id: string }>("execution:question:answered", ({ id }) => {
    setQuestionFor((current) => (current === id ? null : current));
  });

  const playing = executionId !== null && open?.execId === executionId ? open.activity : null;
  const endedActivity = playing !== null && !live ? playing : null;

  useEffect(() => {
    if (endedActivity) addToast("info", ENDED[endedActivity]);
  }, [endedActivity, addToast]);

  const handleUnavailable = useCallback((reason: Unavailable) => {
    if (reason === "awaiting-input") {
      setQuestionFor(executionId);
      return;
    }
    if (open) addToast("info", NOT_RUNNING[open.activity]);
    setOpen(null);
  }, [executionId, open, addToast]);

  if (!live || executionId === null) return null;

  if (!playing) {
    return (
      <div className="game-launchers">
        {admin && (
          <button
            type="button"
            className="game-launcher"
            onClick={() => setOpen({ execId: executionId, activity: "spanish" })}
            aria-label="Estudar espanhol enquanto a execução continua"
            title="Estudar espanhol enquanto espera"
          >
            <Languages size={15} aria-hidden="true" />
            <span className="game-launcher-label">Aula de espanhol</span>
          </button>
        )}
        <button
          type="button"
          className="game-launcher"
          onClick={() => setOpen({ execId: executionId, activity: "decanta" })}
          aria-label="Jogar Decanta enquanto a execução continua"
          title="Jogar enquanto espera"
        >
          <FlaskConical size={15} aria-hidden="true" />
          <span className="game-launcher-label">Jogar enquanto espera</span>
        </button>
      </div>
    );
  }

  const hidden = awaitingInput || questionFor === executionId;
  const close = () => setOpen(null);

  if (playing === "spanish") {
    return <SpanishLesson key={executionId} execId={executionId} hidden={hidden} activity={activity} onClose={close} onUnavailable={handleUnavailable} />;
  }

  return <DecantaGame key={executionId} execId={executionId} hidden={hidden} activity={activity} onClose={close} onUnavailable={handleUnavailable} />;
}
