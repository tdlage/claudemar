import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { useSocketEvent } from "./useSocket";
import type {
  Pipeline,
  PipelineBundle,
  PipelineCard,
  PipelineIntakePlugin,
  PipelineStageRun,
} from "../lib/types";

function usePipelineData<T>(path: string | null, deps: unknown[] = []) {
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

// Múltiplos hooks (usePipeline/usePipelineCards/useCardRuns) montam/desmontam de forma
// independente; ref-count garante que a sala "pipeline" só é deixada quando o último sai
// (senão fechar o detalhe do card derrubava os updates ao vivo do board).
let pipelineRoomRefs = 0;

function usePipelineSocket() {
  useEffect(() => {
    const socket = getSocket();
    if (pipelineRoomRefs === 0) socket.emit("subscribe:pipeline");
    pipelineRoomRefs++;
    return () => {
      pipelineRoomRefs--;
      if (pipelineRoomRefs === 0) socket.emit("unsubscribe:pipeline");
    };
  }, []);
}

export function usePipeline(project: string | undefined) {
  const path = project ? `/pipeline/projects/${project}` : null;
  const { data, setData, loading, error, refresh } = usePipelineData<PipelineBundle>(path, [project]);

  usePipelineSocket();

  useSocketEvent<Pipeline>("pipeline:pipeline:update", (pipeline) => {
    setData((prev) => (prev ? { ...prev, pipeline } : prev));
  });
  useSocketEvent<PipelineIntakePlugin>("pipeline:plugin:create", (plugin) => {
    setData((prev) => (prev ? { ...prev, plugins: [...prev.plugins, plugin] } : prev));
  });
  useSocketEvent<PipelineIntakePlugin>("pipeline:plugin:update", (plugin) => {
    setData((prev) => (prev ? { ...prev, plugins: prev.plugins.map((p) => (p.id === plugin.id ? plugin : p)) } : prev));
  });
  useSocketEvent<{ id: string }>("pipeline:plugin:delete", ({ id }) => {
    setData((prev) => (prev ? { ...prev, plugins: prev.plugins.filter((p) => p.id !== id) } : prev));
  });

  return { bundle: data, loading, error, refresh };
}

export function usePipelineCards(pipelineId: string | undefined) {
  const path = pipelineId ? `/pipeline/${pipelineId}/cards` : null;
  const { data, setData, loading, error, refresh } = usePipelineData<PipelineCard[]>(path, [pipelineId]);

  usePipelineSocket();

  useSocketEvent<PipelineCard>("pipeline:card:create", (card) => {
    if (card.pipelineId === pipelineId) {
      setData((prev) => (prev ? [...prev.filter((c) => c.id !== card.id), card] : [card]));
    }
  });
  useSocketEvent<PipelineCard>("pipeline:card:update", (card) => {
    setData((prev) => prev?.map((c) => (c.id === card.id ? card : c)) ?? null);
  });
  useSocketEvent<{ id: string }>("pipeline:card:delete", ({ id }) => {
    setData((prev) => prev?.filter((c) => c.id !== id) ?? null);
  });

  return { cards: data ?? [], loading, error, refresh };
}

export function useCardRuns(cardId: string | undefined) {
  const path = cardId ? `/pipeline/cards/${cardId}/runs` : null;
  const { data, loading, refresh } = usePipelineData<PipelineStageRun[]>(path, [cardId]);

  usePipelineSocket();

  // Runs carry signed screenshot URLs only from REST, so refetch on socket signal.
  useSocketEvent<PipelineStageRun>("pipeline:run:create", (run) => {
    if (run.cardId === cardId) refresh();
  });
  useSocketEvent<PipelineStageRun>("pipeline:run:update", (run) => {
    if (run.cardId === cardId) refresh();
  });

  return { runs: data ?? [], loading, refresh };
}
