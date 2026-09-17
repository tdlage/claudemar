import type { PendingQuestion } from "../providers/types.js";

export type QuestionAnswers = Record<string, string>;

interface WaitingQuestion {
  question: PendingQuestion;
  resolve: (answers: QuestionAnswers) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class SessionQuestions {
  private pending = new Map<string, WaitingQuestion>();

  constructor(
    private readonly onQuestion: (question: PendingQuestion) => void,
    private readonly onResolved: (id: string) => void,
  ) {}

  get waiting(): boolean {
    return this.pending.size > 0;
  }

  request(question: PendingQuestion, signal?: AbortSignal): Promise<QuestionAnswers> {
    if (signal?.aborted) return Promise.reject(new Error("Pergunta cancelada."));
    if (!question.questions.length || this.pending.has(question.toolUseId)) return Promise.reject(new Error("Pergunta inválida ou duplicada."));
    if (new Set(question.questions.map((q) => q.question)).size !== question.questions.length) return Promise.reject(new Error("Cada pergunta deve ter um texto distinto."));
    return new Promise((resolve, reject) => {
      const abort = () => this.finish(question.toolUseId, undefined, "Pergunta cancelada.");
      const first = !this.waiting;
      this.pending.set(question.toolUseId, { question, resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
      signal?.addEventListener("abort", abort, { once: true });
      if (first) this.onQuestion(question);
    });
  }

  answer(id: string, text: string, answers?: QuestionAnswers): boolean {
    const entry = this.pending.get(id);
    if (!entry || this.pending.keys().next().value !== id) return false;
    const values: QuestionAnswers = {};
    for (const q of entry.question.questions) {
      const value = answers?.[q.question] ?? (entry.question.questions.length === 1 ? text : undefined);
      if (typeof value !== "string" || !value.trim()) return false;
      Object.defineProperty(values, q.question, { value: value.trim(), enumerable: true });
    }
    this.finish(id, values);
    return true;
  }

  cancelAll(message = "Execução interrompida."): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      entry.cleanup();
      this.onResolved(entry.question.toolUseId);
      entry.reject(new Error(message));
    }
  }

  private finish(id: string, answers?: QuestionAnswers, error?: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    const first = this.pending.keys().next().value === id;
    this.pending.delete(id);
    entry.cleanup();
    this.onResolved(id);
    if (answers) entry.resolve(answers);
    else entry.reject(new Error(error));
    const next = this.pending.values().next().value;
    if (first && next) this.onQuestion(next.question);
  }
}
