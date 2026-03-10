import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useSocketEvent, useSocketRoom } from "./useSocket";
import type {
  TrackerProject,
  TrackerCycle,
  TrackerBet,
  TrackerComment,
  TrackerTestCase,
  TrackerTestRun,
  TrackerTestRunComment,
} from "../lib/types";

function useTrackerData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh, ...deps]);

  return { data, setData, loading, error, refresh };
}

function useTrackerSocket() {
  useSocketRoom("tracker");
}

export function useTrackerProjects() {
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerProject[]>("/tracker/projects");

  useTrackerSocket();

  useSocketEvent<TrackerProject>("tracker:project:create", (project) => {
    setData((prev) => (prev ? [...prev, project] : [project]));
  });

  useSocketEvent<TrackerProject>("tracker:project:update", (project) => {
    setData((prev) => prev?.map((p) => (p.id === project.id ? project : p)) ?? null);
  });

  useSocketEvent<{ id: string }>("tracker:project:delete", ({ id }) => {
    setData((prev) => prev?.filter((p) => p.id !== id) ?? null);
  });

  return { projects: data ?? [], loading, error, refresh };
}

export function useCycles(projectId: string | undefined) {
  const path = projectId ? `/tracker/projects/${projectId}/cycles` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerCycle[]>(path, [projectId]);

  useTrackerSocket();

  useSocketEvent<TrackerCycle>("tracker:cycle:create", (cycle) => {
    if (cycle.projectId === projectId) {
      setData((prev) => (prev ? [...prev, cycle] : [cycle]));
    }
  });

  useSocketEvent<TrackerCycle>("tracker:cycle:update", (cycle) => {
    setData((prev) => prev?.map((c) => (c.id === cycle.id ? cycle : c)) ?? null);
  });

  useSocketEvent<{ id: string }>("tracker:cycle:delete", ({ id }) => {
    setData((prev) => prev?.filter((c) => c.id !== id) ?? null);
  });

  return { cycles: data ?? [], loading, error, refresh };
}

export function useBets(cycleId: string | undefined) {
  const path = cycleId ? `/tracker/cycles/${cycleId}/bets` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerBet[]>(path, [cycleId]);

  useTrackerSocket();

  useSocketEvent<TrackerBet>("tracker:bet:create", (bet) => {
    if (bet.cycleId === cycleId) {
      setData((prev) => (prev ? [...prev, bet] : [bet]));
    }
  });

  useSocketEvent<TrackerBet>("tracker:bet:update", (bet) => {
    setData((prev) => prev?.map((b) => (b.id === bet.id ? bet : b)) ?? null);
  });

  useSocketEvent<{ id: string }>("tracker:bet:delete", ({ id }) => {
    setData((prev) => prev?.filter((b) => b.id !== id) ?? null);
  });

  return { bets: data ?? [], loading, error, refresh };
}

export function useComments(targetType: "bet", targetId: string | undefined) {
  const path = targetId ? `/tracker/comments/${targetType}/${targetId}` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerComment[]>(path, [targetType, targetId]);

  useTrackerSocket();

  useSocketEvent<TrackerComment>("tracker:comment:add", (comment) => {
    if (comment.targetType === targetType && comment.targetId === targetId) {
      setData((prev) => (prev ? [...prev, comment] : [comment]));
    }
  });

  useSocketEvent<{ id: string }>("tracker:comment:delete", ({ id }) => {
    setData((prev) => prev?.filter((c) => c.id !== id) ?? null);
  });

  return { comments: data ?? [], loading, error, refresh };
}

export function useTestCases(targetType: "bet", targetId: string | undefined) {
  const path = targetId ? `/tracker/test-cases/${targetType}/${targetId}` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerTestCase[]>(path, [targetType, targetId]);

  useTrackerSocket();

  useSocketEvent<TrackerTestCase>("tracker:testcase:create", (tc) => {
    if (tc.targetType === targetType && tc.targetId === targetId) {
      setData((prev) => (prev ? [...prev, tc] : [tc]));
    }
  });

  useSocketEvent<TrackerTestCase>("tracker:testcase:update", (tc) => {
    setData((prev) => prev?.map((t) => (t.id === tc.id ? tc : t)) ?? null);
  });

  useSocketEvent<{ id: string }>("tracker:testcase:delete", ({ id }) => {
    setData((prev) => prev?.filter((t) => t.id !== id) ?? null);
  });

  useSocketEvent<{ ids: string[] }>("tracker:testcase:reorder", () => {
    refresh();
  });

  return { testCases: data ?? [], loading, error, refresh };
}

export function useTestRuns(testCaseId: string | undefined) {
  const path = testCaseId ? `/tracker/test-cases/${testCaseId}/runs` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerTestRun[]>(path, [testCaseId]);

  useTrackerSocket();

  useSocketEvent<TrackerTestRun>("tracker:testrun:create", (run) => {
    if (run.testCaseId === testCaseId) {
      setData((prev) => (prev ? [run, ...prev] : [run]));
    }
  });

  useSocketEvent<TrackerTestRun>("tracker:testrun:update", (run) => {
    setData((prev) => prev?.map((r) => (r.id === run.id ? run : r)) ?? null);
  });

  useSocketEvent<{ id: string }>("tracker:testrun:delete", ({ id }) => {
    setData((prev) => prev?.filter((r) => r.id !== id) ?? null);
  });

  return { runs: data ?? [], loading, error, refresh };
}

export function useTestRunComments(testRunId: string | undefined) {
  const path = testRunId ? `/tracker/test-runs/${testRunId}/comments` : null;
  const { data, setData, loading, error, refresh } = useTrackerData<TrackerTestRunComment[]>(path, [testRunId]);

  useTrackerSocket();

  useSocketEvent<TrackerTestRunComment>("tracker:testrun:comment", (comment) => {
    if (comment.testRunId === testRunId) {
      setData((prev) => (prev ? [...prev, comment] : [comment]));
    }
  });

  return { comments: data ?? [], loading, error, refresh };
}
