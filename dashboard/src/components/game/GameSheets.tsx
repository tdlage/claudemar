import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Crown, Loader2, Lock, Trophy, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Ranking, RankingEntry } from "./types";

interface SheetProps {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

function Sheet({ title, icon, onClose, children }: SheetProps) {
  return (
    <section className="decanta-sheet" aria-label={title}>
      <header className="decanta-sheet-header">
        <h2>{icon}{title}</h2>
        <button type="button" className="decanta-tool" onClick={onClose} aria-label={`Fechar ${title.toLowerCase()}`}>
          <X size={16} />
        </button>
      </header>
      {children}
    </section>
  );
}

interface LevelSheetProps {
  level: number;
  maxLevel: number;
  levelsCompleted: number;
  onChoose: (level: number) => void;
  onClose: () => void;
}

function completedLabel(count: number): string {
  return `${count} ${count === 1 ? "fase concluída" : "fases concluídas"}`;
}

export function LevelSheet({ level, maxLevel, levelsCompleted, onChoose, onClose }: LevelSheetProps) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
    current.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Sheet title="Fases" icon={<Crown size={16} aria-hidden="true" />} onClose={onClose}>
      <p className="decanta-sheet-note">Você já chegou até a fase {maxLevel} ({completedLabel(levelsCompleted)}). Jogue qualquer uma delas.</p>
      <div className="decanta-levels">
        {Array.from({ length: maxLevel }, (_, i) => i + 1).map((number) => (
          <button
            key={number}
            ref={number === level ? current : undefined}
            type="button"
            className={`${number === level ? "is-current" : ""} ${number === maxLevel ? "is-record" : ""}`}
            aria-current={number === level ? "true" : undefined}
            aria-label={`Fase ${number}${number === level ? ", atual" : ""}${number === maxLevel ? ", mais distante" : ""}`}
            onClick={() => onChoose(number)}
          >
            {number}
          </button>
        ))}
        <span className="decanta-level-locked" aria-label={`Fase ${maxLevel + 1}, bloqueada`}>
          <Lock size={13} aria-hidden="true" />
          {maxLevel + 1}
        </span>
      </div>
    </Sheet>
  );
}

function medal(position: number): string {
  return ["is-gold", "is-silver", "is-bronze"][position - 1] ?? "";
}

function RankingRow({ entry }: { entry: RankingEntry }) {
  return (
    <li className={entry.me ? "is-me" : undefined}>
      <span className={`decanta-medal ${medal(entry.position)}`}>{entry.position}</span>
      <span className="decanta-ranking-name">
        <strong>{entry.name}</strong>
        {entry.me && <em>você</em>}
        <small>{formatDistanceToNow(new Date(entry.reachedAt), { addSuffix: true, locale: ptBR })} · {completedLabel(entry.levelsCompleted)}</small>
      </span>
      <span className="decanta-ranking-level">fase {entry.maxLevel}</span>
    </li>
  );
}

export function RankingSheet({ onClose }: { onClose: () => void }) {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<Ranking>("/game/ranking")
      .then((data) => { if (alive) setRanking(data); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Não foi possível carregar o ranking."); });
    return () => { alive = false; };
  }, []);

  const outside = ranking?.me && !ranking.entries.some((entry) => entry.me) ? ranking.me : null;

  return (
    <Sheet title="Ranking" icon={<Trophy size={16} aria-hidden="true" />} onClose={onClose}>
      <p className="decanta-sheet-note">Vale a fase mais distante que cada pessoa já alcançou.</p>
      {error && <p className="decanta-sheet-error" role="alert">{error}</p>}
      {!ranking && !error && <p className="decanta-sheet-note" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando…</p>}
      {ranking && ranking.entries.length === 0 && <p className="decanta-sheet-note">Ninguém entrou no ranking ainda. Faça a primeira jogada para aparecer aqui.</p>}
      {ranking && ranking.entries.length > 0 && (
        <ol className="decanta-ranking">
          {ranking.entries.map((entry) => <RankingRow key={`${entry.position}:${entry.name}`} entry={entry} />)}
          {outside && <RankingRow entry={outside} />}
        </ol>
      )}
    </Sheet>
  );
}
