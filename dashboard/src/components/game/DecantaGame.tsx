import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, CircleCheck, CircleHelp, CircleX, Crown, FlaskConical, LayoutGrid, Loader2, RotateCcw, SearchCheck, Shapes, Sparkles, Trophy, Undo2, Volume2, VolumeX, X,
} from "lucide-react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import type { GameSnapshot, Unavailable } from "./controller";
import { GameBoard } from "./GameBoard";
import { LevelSheet, RankingSheet } from "./GameSheets";
import type { CompletedLevel, Verdict } from "./types";
import { useDecanta, useStoredFlag } from "./useDecanta";

interface Props {
  execId: string;
  hidden: boolean;
  activity?: string;
  onClose: () => void;
  onUnavailable: (reason: Unavailable) => void;
}

type Panel = "levels" | "ranking" | null;

interface ToolProps {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Tool({ label, pressed, onClick, children }: ToolProps) {
  return (
    <button type="button" className="play-tool" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

interface WinProps {
  completed: CompletedLevel;
  nextReady: boolean;
  onNext: () => void;
  onReplay: () => void;
  onRanking: () => void;
}

function WinCard({ completed, nextReady, onNext, onReplay, onRanking }: WinProps) {
  return (
    <div className="play-modal">
      <section className="play-card is-win" role="alertdialog" aria-label={`Fase ${completed.level} concluída`}>
        <div className="play-card-icon" aria-hidden="true"><Sparkles size={26} /></div>
        <h2>Fase {completed.level} concluída!</h2>
        <p>{completed.moves} {completed.moves === 1 ? "jogada" : "jogadas"}</p>
        {completed.record && (
          <p className="decanta-record"><Crown size={15} aria-hidden="true" />Novo recorde: fase {completed.level + 1} liberada</p>
        )}
        <div className="play-card-actions">
          <button type="button" className="play-button is-primary" onClick={onNext} disabled={!nextReady} autoFocus>
            {nextReady ? <>Próxima fase<ChevronRight size={16} aria-hidden="true" /></> : <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Salvando…</>}
          </button>
          <button type="button" className="play-button" onClick={onReplay}><RotateCcw size={15} aria-hidden="true" />Jogar de novo</button>
          <button type="button" className="play-button is-ghost" onClick={onRanking}><Trophy size={15} aria-hidden="true" />Ver ranking</button>
        </div>
      </section>
    </div>
  );
}

const VERDICTS: Record<Verdict, { tone: string; icon: React.ReactNode; text: string }> = {
  solvable: { tone: "is-good", icon: <CircleCheck size={16} aria-hidden="true" />, text: "Ainda tem saída: dá para resolver a partir daqui." },
  unsolvable: { tone: "is-bad", icon: <CircleX size={16} aria-hidden="true" />, text: "Não tem mais saída. Desfaça algumas jogadas ou reinicie a fase." },
  unknown: { tone: "is-unknown", icon: <CircleHelp size={16} aria-hidden="true" />, text: "Este tabuleiro é complexo demais para eu confirmar agora." },
};

function VerdictNote({ verdict, onDismiss }: { verdict: Verdict | "checking"; onDismiss: () => void }) {
  if (verdict === "checking") {
    return <p className="decanta-verdict" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Verificando se ainda tem saída…</p>;
  }
  const { tone, icon, text } = VERDICTS[verdict];
  return (
    <button type="button" className={`decanta-verdict ${tone}`} role="status" onClick={onDismiss} title="Fechar">
      {icon}{text}
    </button>
  );
}

interface StuckProps {
  snapshot: GameSnapshot;
  onUndo: () => void;
  onRestart: () => void;
  onPrevious: () => void;
  onLevels: () => void;
}

function StuckCard({ snapshot, onUndo, onRestart, onPrevious, onLevels }: StuckProps) {
  return (
    <div className="play-modal">
      <section className="play-card is-stuck" role="alertdialog" aria-label="Sem saída">
        <div className="play-card-icon" aria-hidden="true"><FlaskConical size={26} /></div>
        <h2>Sem saída</h2>
        <p>{snapshot.exhausted ? `Esta tentativa chegou ao limite de ${snapshot.moveLimit} jogadas.` : "Não há mais nenhuma jogada possível."}</p>
        <div className="play-card-actions">
          {snapshot.moves > 0 && (
            <button type="button" className="play-button is-primary" onClick={onUndo} autoFocus><Undo2 size={15} aria-hidden="true" />Desfazer a última jogada</button>
          )}
          <button type="button" className={`play-button${snapshot.moves > 0 ? "" : " is-primary"}`} onClick={onRestart} autoFocus={snapshot.moves === 0}><RotateCcw size={15} aria-hidden="true" />Reiniciar a fase</button>
          {snapshot.level > 1 && (
            <button type="button" className="play-button" onClick={onPrevious}><ChevronLeft size={15} aria-hidden="true" />Voltar para a fase {snapshot.level - 1}</button>
          )}
          <button type="button" className="play-button is-ghost" onClick={onLevels}><LayoutGrid size={15} aria-hidden="true" />Escolher outra fase</button>
        </div>
      </section>
    </div>
  );
}

export function DecantaGame({ execId, hidden, activity, onClose, onUnavailable }: Props) {
  const [muted, setMuted] = useStoredFlag("decanta:muted", false);
  const [symbols, setSymbols] = useStoredFlag("decanta:symbols", false);
  const { controller, snapshot } = useDecanta(execId, muted, onUnavailable);
  const [panel, setPanel] = useState<Panel>(null);
  const windowRef = useRef<HTMLElement>(null);
  const visible = !hidden;

  useEffect(() => {
    if (visible) void controller.refresh();
  }, [visible, controller]);

  useDialogFocus(windowRef, visible, () => {
    if (panel) setPanel(null);
    else if (!controller.deselect()) onClose();
  });

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']"))) return;
      const undo = event.key === "Backspace" || ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z");
      if (undo) {
        event.preventDefault();
        controller.undo();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      const tube = "1234567890".indexOf(event.key);
      if (tube >= 0) {
        event.preventDefault();
        controller.tap(tube);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, controller]);

  const choose = (level: number) => {
    setPanel(null);
    controller.chooseLevel(level);
  };
  const editable = snapshot.phase === "playing" || snapshot.phase === "stuck";
  const colors = new Set(snapshot.tubes.flat()).size;

  return createPortal(
    <div className="play-layer" hidden={hidden}>
      <section ref={windowRef} className="play-window" role="dialog" aria-modal="true" aria-label="Decanta, jogo de decantar cores" tabIndex={-1}>
        <div className="play-ambient" aria-hidden="true"><span /><span /><span /></div>
        <header className="play-header">
          <div className="play-brand"><FlaskConical size={18} aria-hidden="true" /><span>Decanta</span></div>
          <div className="decanta-level">
            <strong>Fase {snapshot.level}</strong>
            {colors > 0 && <span className="decanta-spec">{colors} cores · {snapshot.capacity} divisões</span>}
            {snapshot.maxLevel > snapshot.level && <span>recorde: fase {snapshot.maxLevel}</span>}
          </div>
          <div className="play-activity" title="A execução continua enquanto você joga">
            <span className="status-dot is-running" aria-hidden="true" />
            <span>Trabalhando{activity ? <> · <code>{activity}</code></> : "…"}</span>
          </div>
          <div className="play-tools">
            <Tool label={muted ? "Ativar som" : "Silenciar"} onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
            </Tool>
            <Tool label="Mostrar símbolos nas cores" pressed={symbols} onClick={() => setSymbols(!symbols)}>
              <Shapes size={17} aria-hidden="true" />
            </Tool>
            <Tool label="Escolher fase" pressed={panel === "levels"} onClick={() => setPanel(panel === "levels" ? null : "levels")}>
              <LayoutGrid size={17} aria-hidden="true" />
            </Tool>
            <Tool label="Ranking" pressed={panel === "ranking"} onClick={() => setPanel(panel === "ranking" ? null : "ranking")}>
              <Trophy size={17} aria-hidden="true" />
            </Tool>
            <Tool label="Fechar o jogo" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </Tool>
          </div>
        </header>

        <div className="play-stage">
          <GameBoard controller={controller} snapshot={snapshot} paused={hidden} symbols={symbols} />
          {snapshot.phase === "playing" && snapshot.level <= 2 && snapshot.moves === 0 && !panel && (
            <p className="decanta-hint">Toque em um frasco e depois em outro para despejar. Junte cada cor em um só frasco.</p>
          )}
          {snapshot.phase === "loading" && (
            <div className="play-loading" role="status"><Loader2 size={18} className="animate-spin" aria-hidden="true" />Preparando a fase…</div>
          )}
          {snapshot.phase === "won" && snapshot.completed && !panel && (
            <WinCard
              completed={snapshot.completed}
              nextReady={snapshot.nextReady}
              onNext={() => controller.advance()}
              onReplay={() => controller.chooseLevel(snapshot.completed!.level)}
              onRanking={() => setPanel("ranking")}
            />
          )}
          {snapshot.phase === "stuck" && !panel && (
            <StuckCard
              snapshot={snapshot}
              onUndo={() => controller.undo()}
              onRestart={() => controller.restart()}
              onPrevious={() => controller.chooseLevel(snapshot.level - 1)}
              onLevels={() => setPanel("levels")}
            />
          )}
          {panel === "levels" && <LevelSheet level={snapshot.level} maxLevel={snapshot.maxLevel} levelsCompleted={snapshot.levelsCompleted} onChoose={choose} onClose={() => setPanel(null)} />}
          {panel === "ranking" && <RankingSheet onClose={() => setPanel(null)} />}
          {snapshot.verdict && snapshot.phase === "playing" && !panel && !snapshot.error && (
            <VerdictNote verdict={snapshot.verdict} onDismiss={() => controller.dismissVerdict()} />
          )}
          {snapshot.error && <p className="play-error" role="alert">{snapshot.error}</p>}
        </div>

        <footer className="play-footer">
          <span className="decanta-moves" aria-live="polite">{snapshot.moves} {snapshot.moves === 1 ? "jogada" : "jogadas"}</span>
          <button type="button" className="play-button" onClick={() => controller.undo()} disabled={!editable || snapshot.moves === 0} aria-label="Desfazer" title="Desfazer a última jogada (Ctrl+Z)">
            <Undo2 size={16} aria-hidden="true" /><span className="play-button-label">Desfazer</span>
          </button>
          <button type="button" className="play-button" onClick={() => controller.check()} disabled={snapshot.phase !== "playing" || snapshot.verdict === "checking"} aria-label="Tem saída?" title="Verificar se ainda dá para resolver a partir daqui">
            <SearchCheck size={16} aria-hidden="true" /><span className="play-button-label">Tem saída?</span>
          </button>
          <button type="button" className="play-button" onClick={() => controller.restart()} disabled={!editable || snapshot.moves === 0} aria-label="Reiniciar">
            <RotateCcw size={16} aria-hidden="true" /><span className="play-button-label">Reiniciar</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
