import type { Contrast, Skill, Verdict } from "./types";

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
