import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../../lib/api";
import type { CourseState, Slot, StateResponse, StudentInfo, Unavailable } from "./types";

const POLL_MS = 2500;
const CONNECTION_ERROR = "Não foi possível falar com o servidor. Tente de novo.";

function isUnavailable(value: unknown): value is Unavailable {
  return value === "awaiting-input" || value === "not-running";
}

function isWaiting(state: CourseState | null): boolean {
  if (!state) return false;
  if (state.status === "preparing-course" || state.status === "preparing-lesson") return !state.error;
  const lesson = state.lesson;
  if (!lesson) return false;
  if (lesson.completed) return lesson.review?.status === "pending" || Boolean(state.next && !state.next.ready && !state.next.error);
  return lesson.steps.some((step) => step.questions.some((question) => question.status === "pending")
    || (step.kind === "exercise" && (step.exercise.result?.status === "grading" || step.exercise.result?.appeal === "pending")));
}

export interface SpanishActions {
  start: () => void;
  proceed: (lessonId: string, cursor: number) => void;
  answer: (lessonId: string, index: number, answer: string | number) => void;
  appeal: (lessonId: string, index: number) => void;
  ask: (lessonId: string, step: number, question: string) => Promise<boolean>;
  next: () => void;
  goTo: (slot: Slot) => void;
  retry: () => void;
  reinforce: () => void;
  saveStudent: (student: StudentInfo) => Promise<boolean>;
}

export function useSpanishCourse(execId: string, visible: boolean, onUnavailable: (reason: Unavailable) => void) {
  const [state, setState] = useState<CourseState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = useRef(onUnavailable);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    unavailable.current = onUnavailable;
  }, [onUnavailable]);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<StateResponse>(`/spanish?execId=${encodeURIComponent(execId)}&timeZone=${encodeURIComponent(timeZone)}`);
      setState(response.state);
      if (isUnavailable(response.availability)) unavailable.current(response.availability);
    } catch (err) {
      setError(err instanceof Error ? err.message : CONNECTION_ERROR);
    }
  }, [execId, timeZone]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const waiting = isWaiting(state);
  useEffect(() => {
    if (!visible || !waiting) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, waiting, refresh]);

  const mutate = useCallback(async (path: string, body: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<StateResponse>(`/spanish/${path}`, { ...body, execId, timeZone });
      setState(response.state);
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (isUnavailable(err.body.availability)) unavailable.current(err.body.availability);
        if (err.body.state) setState(err.body.state as CourseState);
        setError(err.message);
      } else {
        setError(CONNECTION_ERROR);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [execId, timeZone]);

  const actions = useMemo<SpanishActions>(() => ({
    start: () => void mutate("start"),
    proceed: (lessonId, cursor) => void mutate("continue", { lessonId, cursor }),
    answer: (lessonId, index, answer) => void mutate("answer", { lessonId, index, answer }),
    appeal: (lessonId, index) => void mutate("appeal", { lessonId, index }),
    ask: (lessonId, step, question) => mutate("ask", { lessonId, step, question }),
    next: () => void mutate("next"),
    goTo: (slot) => void mutate("goto", { unit: slot.unit, step: slot.step }),
    retry: () => void mutate("retry"),
    reinforce: () => void mutate("reinforce"),
    saveStudent: (student) => mutate("student", { student: { ...student } }),
  }), [mutate]);

  return { state, busy, error, timeZone, actions, dismissError: () => setError(null) };
}
