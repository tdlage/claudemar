import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { useSocketEvent } from "./useSocket";
import type {
  BackfillState,
  BrainActivityItem,
  BrainQuarantineItem,
  BrainSettings,
  BrainStatus,
  BrainTenantEntry,
  GoogleAccountStatus,
} from "../lib/types";

let brainRoomRefs = 0;

export function useBrainRoom(): void {
  useEffect(() => {
    let socket = getSocket();
    const subscribe = (): void => {
      socket.emit("subscribe:brain");
    };
    subscribe();
    brainRoomRefs++;
    socket.on("connect", subscribe);
    const rebind = setInterval(() => {
      const current = getSocket();
      if (current === socket) return;
      socket.off("connect", subscribe);
      socket = current;
      socket.on("connect", subscribe);
      subscribe();
    }, 5000);
    return () => {
      clearInterval(rebind);
      socket.off("connect", subscribe);
      brainRoomRefs--;
      if (brainRoomRefs === 0) socket.emit("unsubscribe:brain");
    };
  }, []);
}

export function useBrainData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(() => {
    const seq = ++requestSeq.current;
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((value) => {
        if (seq === requestSeq.current) setData(value);
      })
      .catch((e) => {
        if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, setData, loading, error, refresh };
}

export function useTenants() {
  const { data, loading, refresh } = useBrainData<BrainTenantEntry[]>("/brain/tenants");
  return { tenants: (data ?? []).filter((t) => !t.merged_into), loading, refresh };
}

export function useBrainStatus() {
  useBrainRoom();
  const { data, setData, loading, error, refresh } = useBrainData<BrainStatus>("/brain/status");

  useSocketEvent<BrainStatus>("brain:status", (status) => setData(status));
  useSocketEvent<BackfillState>("brain:backfill", (backfill) =>
    setData((prev) => (prev ? { ...prev, backfill } : prev)),
  );

  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { status: data, loading, error, refresh };
}

export function useBrainActivity() {
  useBrainRoom();
  const { data, setData, loading } = useBrainData<BrainActivityItem[]>("/brain/activity?limit=30");
  useSocketEvent<BrainActivityItem>("brain:activity", (item) =>
    setData((prev) => [item, ...(prev ?? [])].slice(0, 50)),
  );
  return { activity: data ?? [], loading };
}

export function useBrainSettings() {
  const [settings, setSettings] = useState<BrainSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<BrainSettings>("/brain/settings")
      .then((s) => {
        setSettings(s);
        setDirty(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback((updater: (prev: BrainSettings) => BrainSettings) => {
    setSettings((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!settings) return false;
    setSaving(true);
    try {
      const current = await api.get<BrainSettings>("/brain/settings").catch(() => null);
      const payload = current ? { ...settings, schedulers: current.schedulers } : settings;
      const updated = await api.put<BrainSettings>("/brain/settings", payload);
      setSettings(updated);
      setDirty(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return { settings, patch, save, saving, loading, error, dirty, reload: load };
}

export function useGoogleAccounts() {
  useBrainRoom();
  const { data, setData, loading, refresh } = useBrainData<GoogleAccountStatus[]>("/brain/google/accounts");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useSocketEvent<{ connected: boolean; email: string }>("brain:google", () => refresh());

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const connect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { authUrl } = await api.post<{ authUrl: string }>("/brain/google/start", {});
      const popup = window.open(authUrl, "brain-google", "width=540,height=680");
      if (!popup) {
        window.open(authUrl, "_blank");
      }
      stopPolling();
      const startedAt = Date.now();
      pollTimer.current = setInterval(() => {
        refresh();
        if (Date.now() - startedAt > 5 * 60_000 || (popup && popup.closed)) stopPolling();
      }, 3000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [refresh, stopPolling]);

  const disconnect = useCallback(
    async (email: string) => {
      const res = await api.post<{ accounts: GoogleAccountStatus[] }>("/brain/google/disconnect", { email });
      setData(res.accounts);
    },
    [setData],
  );

  const updateAccount = useCallback(
    async (email: string, patch: { tenant?: string; label?: string }) => {
      const accounts = await api.post<GoogleAccountStatus[]>("/brain/google/account", { email, ...patch });
      setData(accounts);
    },
    [setData],
  );

  return { accounts: data ?? [], loading, refresh, connect, disconnect, updateAccount };
}

export function useQuarantine() {
  useBrainRoom();
  const { data, setData, loading, error, refresh } = useBrainData<BrainQuarantineItem[]>("/brain/quarantine");
  useSocketEvent<BrainActivityItem>("brain:activity", (item) => {
    if (item.kind === "quarantine") refresh();
  });

  const discard = useCallback(
    async (id: string) => {
      await api.post(`/brain/quarantine/${id}/discard`, {});
      setData((prev) => prev?.filter((i) => i.id !== id) ?? null);
    },
    [setData],
  );

  const retry = useCallback(
    async (id: string): Promise<string> => {
      const res = await api.post<{ requeued: string }>(`/brain/quarantine/${id}/retry`, {});
      setData((prev) => prev?.filter((i) => i.id !== id) ?? null);
      return res.requeued;
    },
    [setData],
  );

  return { items: data ?? [], loading, error, refresh, discard, retry };
}
