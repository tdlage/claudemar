import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CircleCheck, Dumbbell, GraduationCap, Loader2, Save, Trophy } from "lucide-react";
import { readStudentDraft, STUDENT_DRAFT_KEY, writeDraft } from "./drafts";
import { ERROR_CATEGORY_LABELS, PACE_LABELS, PRIORITY_LABELS, SKILL_LABELS, TREND_LABELS } from "./labels";
import { Loading, Sheet } from "./SpanishSheets";
import type { ReviewEntry, StudentInfo, TeacherOverview, Weakness } from "./types";
import { useOverview } from "./useOverview";

interface Props {
  timeZone: string;
  busy: boolean;
  reinforcing: boolean;
  onReinforce: () => void;
  onSaveStudent: (student: StudentInfo) => Promise<boolean>;
  onClose: () => void;
}

function ago(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

function lessonLabel(entry: ReviewEntry): string {
  return entry.kind === "reinforcement" ? "Aula de reforço" : `Unidade ${entry.unit} · aula ${entry.step}`;
}

function Comment({ entry }: { entry: ReviewEntry }) {
  return (
    <blockquote className="espanol-teacher-note">
      <span><GraduationCap size={14} aria-hidden="true" />{lessonLabel(entry)} · {ago(entry.completedAt)}</span>
      <p>{entry.review.comment}</p>
    </blockquote>
  );
}

function WeaknessCard({ weakness }: { weakness: Weakness }) {
  return (
    <li className={`is-${weakness.priority}`}>
      <div className="espanol-weakness-head">
        <strong>{weakness.title}</strong>
        <span className={`espanol-badge is-priority-${weakness.priority}`}>{PRIORITY_LABELS[weakness.priority]}</span>
        <span className="espanol-trend">{TREND_LABELS[weakness.trend]}</span>
      </div>
      <small className="espanol-muted">{SKILL_LABELS[weakness.skill]} · desde {ago(weakness.since)}</small>
      <p>{weakness.rule}</p>
      {weakness.interference && <p className="espanol-muted"><strong>Por que acontece:</strong> {weakness.interference}</p>}
      {weakness.examples.length > 0 && (
        <ul className="espanol-weakness-examples">
          {weakness.examples.map((example) => (
            <li key={`${example.wrong}:${example.right}`}><s lang="es">{example.wrong}</s> → <strong lang="es">{example.right}</strong></li>
          ))}
        </ul>
      )}
    </li>
  );
}

function StudentForm({ student, examDaysLeft, busy, onSave }: { student: StudentInfo; examDaysLeft: number | null; busy: boolean; onSave: (student: StudentInfo) => Promise<boolean> }) {
  const [form, setForm] = useState<StudentInfo>(() => readStudentDraft() ?? student);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<StudentInfo>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setSaved(false);
    writeDraft(STUDENT_DRAFT_KEY, JSON.stringify(next));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!(await onSave(form))) return;
    writeDraft(STUDENT_DRAFT_KEY, "");
    setSaved(true);
  };

  return (
    <form className="espanol-teacher-section espanol-student" onSubmit={submit}>
      <h3>Sobre você</h3>
      <p className="espanol-muted">O professor usa isso para escolher temas, ajustar o ritmo e preparar você para a prova.</p>
      <label className="espanol-field">
        <span>Objetivo</span>
        <input value={form.goal} onChange={(event) => update({ goal: event.target.value })} maxLength={300} placeholder="Ex.: passar no DELE B2 e trabalhar com clientes da Espanha" />
      </label>
      <label className="espanol-field">
        <span>Data da prova do DELE{examDaysLeft !== null && form.examDate === student.examDate ? ` · faltam ${examDaysLeft} dias` : ""}</span>
        <input type="date" value={form.examDate ?? ""} onChange={(event) => update({ examDate: event.target.value || null })} />
      </label>
      <label className="espanol-field">
        <span>Interesses</span>
        <textarea value={form.interests} onChange={(event) => update({ interests: event.target.value })} maxLength={600} rows={2} placeholder="Temas que você gosta de ler e escrever: tecnologia, viagens, negócios…" />
      </label>
      <label className="espanol-field">
        <span>Recado para o professor</span>
        <textarea value={form.notes} onChange={(event) => update({ notes: event.target.value })} maxLength={1500} rows={3} placeholder="O que você quer treinar mais, o que acha difícil, como prefere estudar…" />
      </label>
      <fieldset className="espanol-variant">
        <legend>Variante do espanhol</legend>
        <label><input type="radio" name="variant" checked={form.variant === "peninsular"} onChange={() => update({ variant: "peninsular" })} />Espanha (vosotros)</label>
        <label><input type="radio" name="variant" checked={form.variant === "americana"} onChange={() => update({ variant: "americana" })} />América (ustedes)</label>
      </fieldset>
      <div className="espanol-student-actions">
        <button type="submit" className="play-button" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}Salvar
        </button>
        {saved && <span role="status"><CircleCheck size={14} aria-hidden="true" />Salvo. O professor vai considerar isso nas próximas aulas.</span>}
      </div>
    </form>
  );
}

function TeacherBody({ data, busy, reinforcing, onReinforce, onSaveStudent }: Omit<Props, "timeZone" | "onClose"> & { data: TeacherOverview }) {
  const [latest, ...older] = data.reviews;
  const { profile } = data;
  const mostErrors = Math.max(1, ...data.categories.map((item) => item.count));
  return (
    <div className="espanol-sheet-body">
      {latest ? <Comment entry={latest} /> : <p className="play-sheet-note">O professor comenta cada aula assim que você a conclui.</p>}
      {profile && (
        <p className="espanol-pace"><strong>Ritmo: {PACE_LABELS[profile.pace].title}</strong>{PACE_LABELS[profile.pace].description}</p>
      )}
      <button type="button" className="play-button is-primary espanol-reinforce" onClick={onReinforce} disabled={busy || reinforcing}>
        <Dumbbell size={15} aria-hidden="true" />{reinforcing ? "Você já está numa aula de reforço" : "Pedir uma aula de reforço"}
      </button>

      <section className="espanol-teacher-section">
        <h3>Pontos fracos</h3>
        {!profile || profile.weaknesses.length === 0 ? (
          <p className="espanol-muted">{profile ? "Nenhum ponto fraco aberto. Continue assim." : "O professor monta este diagnóstico a partir da sua primeira aula concluída."}</p>
        ) : (
          <ul className="espanol-weaknesses">
            {profile.weaknesses.map((weakness) => <WeaknessCard key={weakness.id} weakness={weakness} />)}
          </ul>
        )}
      </section>

      {data.categories.length > 0 && (
        <section className="espanol-teacher-section">
          <h3>Onde você mais erra nos últimos 30 dias</h3>
          <ul className="espanol-skills">
            {data.categories.map((item) => (
              <li key={item.category}>
                <span>{ERROR_CATEGORY_LABELS[item.category]}</span>
                <span className="espanol-meter is-errors" aria-hidden="true"><span style={{ width: `${Math.round((item.count / mostErrors) * 100)}%` }} /></span>
                <small>{item.count}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && profile.strengths.length > 0 && (
        <section className="espanol-teacher-section">
          <h3>Você já domina</h3>
          <ul className="espanol-chips">{profile.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      {profile && profile.resolved.length > 0 && (
        <section className="espanol-teacher-section">
          <h3>Pontos fracos superados</h3>
          <ul className="espanol-resolved">
            {profile.resolved.map((item) => <li key={item.id}><Trophy size={13} aria-hidden="true" />{item.title}<small>{ago(item.resolvedAt)}</small></li>)}
          </ul>
        </section>
      )}

      {older.length > 0 && (
        <details className="espanol-teacher-section espanol-older">
          <summary>Comentários anteriores</summary>
          {older.map((entry) => <Comment key={entry.lessonId} entry={entry} />)}
        </details>
      )}

      <StudentForm student={data.student} examDaysLeft={data.examDaysLeft} busy={busy} onSave={onSaveStudent} />
    </div>
  );
}

export function TeacherSheet({ timeZone, onClose, ...props }: Props) {
  const { data, error } = useOverview<TeacherOverview>("/spanish/teacher", timeZone);
  return (
    <Sheet title="Seu professor" icon={<GraduationCap size={16} aria-hidden="true" />} onClose={onClose}>
      {data ? <TeacherBody data={data} {...props} /> : <Loading error={error} />}
    </Sheet>
  );
}
