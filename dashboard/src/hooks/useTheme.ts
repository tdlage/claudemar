import { useSyncExternalStore } from "react";

const eventName = "claudemar:theme";
const storageKey = "claudemar_theme";

function readTheme(): "bridge" | "paper" {
  return document.documentElement.dataset.theme === "paper"
    ? "paper"
    : "bridge";
}

function subscribe(listener: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key === storageKey) {
      applyTheme(event.newValue === "paper" ? "paper" : "bridge");
    }
  };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", sync);
  };
}

function applyTheme(theme: "bridge" | "paper") {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "paper" ? "#f7f7f2" : "#0f1217");
  window.dispatchEvent(new Event(eventName));
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    readTheme,
    () => "bridge" as const,
  );
  const toggle = () => {
    const next = theme === "bridge" ? "paper" : "bridge";
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Theme still works without storage. */
    }
    applyTheme(next);
  };
  return { theme, toggle };
}
