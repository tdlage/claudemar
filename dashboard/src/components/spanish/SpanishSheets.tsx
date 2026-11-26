import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BookOpen, Check, Loader2, Lock, Map as MapIcon, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { CONTRAST_LABELS, percent, plural, SKILL_LABELS } from "./labels";
import { SpeakButton } from "./LessonSteps";
import type { CourseOverview, Slot, StoredWord, VocabularyCounts, VocabularyOverview } from "./types";

const MAX_BOX = 6;

interface SheetProps {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

function Sheet({ title, icon, onClose, children }: SheetProps) {
  return (
    <section className="play-sheet espanol-sheet" aria-label={title}>
      <header className="play-sheet-header">
        <h2>{icon}{title}</h2>
        <button type="button" className="play-tool" onClick={onClose} aria-label={`Fechar ${title.toLowerCase()}`}>
          <X size={16} />
        </button>
      </header>
      {children}
    </section>
  );
}

function useOverview<T>(path: string, timeZone: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<T>(`${path}?timeZone=${encodeURIComponent(timeZone)}`)
      .then((value) => { if (alive) setData(value); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Não foi possível carregar."); });
    return () => { alive = false; };
  }, [path, timeZone]);
  return { data, error };
}

function Loading({ error }: { error: string | null }) {
  if (error) return <p className="play-sheet-error" role="alert">{error}</p>;
  return <p className="play-sheet-note" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Carregando…</p>;
}

function Counts({ counts }: { counts: VocabularyCounts }) {
  return (
    <dl className="espanol-counts">
      <div><dt>Palavras</dt><dd>{counts.total}</dd></div>
      <div><dt>Dominadas</dt><dd>{counts.mastered}</dd></div>
      <div><dt>Para revisar</dt><dd>{counts.due}</dd></div>
    </dl>
  );
}

function slotIndex(slot: Slot, lessonsPerUnit: number): number {
  return (slot.unit - 1) * lessonsPerUnit + slot.step - 1;
}

interface CourseSheetProps {
  timeZone: string;
  busy: boolean;
  onChoose: (slot: Slot) => void;
  onClose: () => void;
}

export function CourseSheet({ timeZone, busy, onChoose, onClose }: CourseSheetProps) {
  const { data, error } = useOverview<CourseOverview>("/spanish/course", timeZone);
  const currentRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
  }, [data]);

  return (
    <Sheet title="Mapa do curso" icon={<MapIcon size={16} aria-hidden="true" />} onClose={onClose}>
      {!data ? <Loading error={error} /> : (
        <div className="espanol-sheet-body">
          <Counts counts={data.vocabulary} />
          {data.skills.length > 0 && (
            <ul className="espanol-skills" aria-label="Acerto por habilidade">
              {data.skills.map((skill) => (
                <li key={skill.skill}>
                  <span>{SKILL_LABELS[skill.skill]}</span>
                  <span className="espanol-meter" aria-hidden="true"><span style={{ width: percent(skill.accuracy) }} /></span>
                  <small>{percent(skill.accuracy)} · {skill.attempts}</small>
                </li>
              ))}
            </ul>
          )}
          {data.weakFocuses.length > 0 && (
            <p className="play-sheet-note espanol-weak">
              Reforçando nas próximas aulas: {data.weakFocuses.map((item) => `${item.focus} (${percent(item.accuracy)})`).join(", ")}
            </p>
          )}
          <ol className="espanol-units">
            {data.units.map((unit) => {
              const isCurrent = unit.number === data.current.unit;
              return (
                <li key={unit.number} ref={isCurrent ? currentRef : undefined} className={`${isCurrent ? "is-current" : ""}${unit.unlocked ? "" : " is-locked"}`}>
                  <span className="espanol-unit-number">{unit.number}</span>
                  <div className="espanol-unit-text">
                    <strong lang="es">{unit.titleEs}</strong>
                    <small>{unit.level} · {unit.titlePt}</small>
                    {unit.connectors.length > 0 && <small className="espanol-unit-detail" lang="es">{unit.connectors.join(" · ")}</small>}
                  </div>
                  <div className="espanol-unit-lessons">
                    {data.roles.map((role, i) => {
                      const slot = { unit: unit.number, step: i + 1 };
                      const done = unit.lessons[i];
                      const open = slotIndex(slot, data.roles.length) <= slotIndex(data.furthest, data.roles.length);
                      const here = isCurrent && data.current.step === slot.step;
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`espanol-dot${done ? " is-done" : ""}${here ? " is-here" : ""}`}
                          disabled={!open || busy}
                          onClick={() => onChoose(slot)}
                          title={`${role}${done ? ` · melhor nota ${percent(done.best)}` : open ? "" : " · bloqueada"}`}
                          aria-label={`Unidade ${unit.number}, aula ${i + 1}: ${role}${done ? `, concluída com ${percent(done.best)}` : open ? "" : ", bloqueada"}${here ? ", atual" : ""}`}
                        >
                          {done ? <Check size={12} aria-hidden="true" /> : open ? i + 1 : <Lock size={10} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Sheet>
  );
}

function Strength({ box }: { box: number }) {
  return (
    <span className="espanol-strength" aria-label={`Memória ${box} de ${MAX_BOX}`} title={`Memória ${box} de ${MAX_BOX}`}>
      {Array.from({ length: MAX_BOX }, (_, i) => <span key={i} className={i < box ? "is-on" : undefined} />)}
    </span>
  );
}

function WordRow({ word, now }: { word: StoredWord; now: number }) {
  const contrast = CONTRAST_LABELS[word.contrast];
  const due = new Date(word.dueAt).getTime() <= now;
  return (
    <li>
      <div className="espanol-vocab-word">
        <strong lang="es">{word.display}</strong>
        <SpeakButton text={word.display} />
        {contrast && <span className={`espanol-badge is-${word.contrast}`}>{contrast}</span>}
      </div>
      <span className="espanol-vocab-meaning">{word.translation}</span>
      <span className="espanol-vocab-state">
        <Strength box={word.box} />
        <small>{due ? "revisar agora" : `revisar ${formatDistanceToNow(new Date(word.dueAt), { addSuffix: true, locale: ptBR })}`}</small>
      </span>
    </li>
  );
}

function matches(word: StoredWord, term: string): boolean {
  const needle = term.normalize("NFC").toLowerCase();
  return [word.display, word.lemma, word.translation].some((value) => value.normalize("NFC").toLowerCase().includes(needle));
}

export function VocabularySheet({ timeZone, onClose }: { timeZone: string; onClose: () => void }) {
  const { data, error } = useOverview<VocabularyOverview>("/spanish/vocabulary", timeZone);
  const [term, setTerm] = useState("");
  const [now] = useState(() => Date.now());
  const words = useMemo(() => (data?.words ?? []).filter((word) => !term.trim() || matches(word, term.trim())), [data, term]);

  return (
    <Sheet title="Vocabulário" icon={<BookOpen size={16} aria-hidden="true" />} onClose={onClose}>
      {!data ? <Loading error={error} /> : (
        <div className="espanol-sheet-body">
          <Counts counts={data.counts} />
          {data.words.length === 0 ? (
            <p className="play-sheet-note">As palavras aparecem aqui conforme você avança nas aulas.</p>
          ) : (
            <>
              <label className="espanol-search">
                <Search size={14} aria-hidden="true" />
                <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Buscar em espanhol ou português" aria-label="Buscar palavra" />
              </label>
              <p className="play-sheet-note">{plural(words.length, "palavra", "palavras")}</p>
              <ul className="espanol-vocab">
                {words.map((word) => <WordRow key={word.lemma} word={word} now={now} />)}
              </ul>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
