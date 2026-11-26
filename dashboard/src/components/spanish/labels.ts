import type { Contrast, ErrorCategory, Pace, Priority, Skill, Trend, Verdict } from "./types";

export const SKILL_LABELS: Record<Skill, string> = {
  vocabulario: "Vocabulário",
  conectores: "Conectores",
  conjugacion: "Conjugação",
  ser_estar: "Ser e estar",
  falsos_amigos: "Falsos amigos",
  gramatica: "Gramática",
};

export const CONTRAST_LABELS: Record<Contrast, string | null> = {
  cognato: "Cognato",
  falso_amigo: "Falso amigo",
  heterogenerico: "Muda o gênero",
  heterotonico: "Muda a sílaba tônica",
  heterossemantico: "Muda o sentido",
  nenhum: null,
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Correto!",
  partial: "Quase",
  incorrect: "Não foi dessa vez",
};

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  alta: "Prioridade alta",
  media: "Prioridade média",
  baixa: "Prioridade baixa",
};

export const TREND_LABELS: Record<Trend, string> = {
  novo: "novo",
  persistente: "persistente",
  melhorando: "melhorando",
};

export const PACE_LABELS: Record<Pace, { title: string; description: string }> = {
  consolidar: { title: "Consolidar", description: "O professor vai reforçar a base antes de aumentar a dificuldade." },
  manter: { title: "Manter", description: "Você está no ritmo certo: as aulas seguem o plano do curso." },
  acelerar: { title: "Acelerar", description: "Você está indo bem: as próximas aulas ficam mais desafiadoras." },
};

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  conjugacion: "Conjugação",
  ser_estar: "Ser e estar",
  falso_amigo: "Falsos amigos",
  conector: "Conectores",
  vocabulario: "Vocabulário",
  preposicion: "Preposições",
  concordancia: "Concordância",
  ortografia: "Ortografia",
  acentuacion: "Acentuação",
  gramatica: "Gramática",
};
