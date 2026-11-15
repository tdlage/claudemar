import { useEffect, useState, useSyncExternalStore } from "react";
import { DecantaController, type GameSnapshot, type Unavailable } from "./controller";

export function useDecanta(execId: string, muted: boolean, onUnavailable: (reason: Unavailable) => void): { controller: DecantaController; snapshot: GameSnapshot } {
  const [controller] = useState(() => new DecantaController(execId, muted));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.onUnavailable(onUnavailable);
  }, [controller, onUnavailable]);

  useEffect(() => {
    controller.connect();
    return () => controller.disconnect();
  }, [controller]);

  useEffect(() => {
    controller.setMuted(muted);
  }, [controller, muted]);

  return { controller, snapshot };
}

export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const store = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      return;
    }
  };
  return [value, store];
}
