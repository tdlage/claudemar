import { keyedLock } from "../keyed-lock.js";

const GENERATION_ATTEMPTS = 2;

export type Rejection =
  | "no-course"
  | "out-of-sync"
  | "invalid-answer"
  | "invalid-question"
  | "question-pending"
  | "question-limit"
  | "locked-lesson"
  | "not-ready"
  | "course-finished";

export class CourseRejection extends Error {
  constructor(readonly reason: Rejection) {
    super(reason);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Jobs {
  private readonly running = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();

  ensure(key: string, task: () => Promise<void>): void {
    if (this.running.has(key) || this.failures.has(key)) return;
    const run = task()
      .catch((error: unknown) => {
        const message = errorMessage(error);
        this.failures.set(key, message);
        console.error(`[spanish] ${key}: ${message}`);
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, run);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  runningWith(prefix: string): number {
    return [...this.running.keys()].filter((key) => key.startsWith(prefix)).length;
  }

  failure(key: string): string | null {
    return this.failures.get(key) ?? null;
  }

  forget(key: string): void {
    this.failures.delete(key);
  }
}

export const jobs = new Jobs();
export const withCourseLock = keyedLock();
export const withDiagnosisLock = keyedLock();

export async function withAttempts<T>(produce: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return await produce();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
