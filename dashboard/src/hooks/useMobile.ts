import { useEffect, useSyncExternalStore } from "react";

const query = "(max-width: 767px)";
const subscribe = (listener: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
};

export function useMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? window.innerWidth < 768, () => false);
}

export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let restingHeight = window.innerHeight;
    let width = window.innerWidth;
    const update = () => {
      const mobile = window.innerWidth < 768;
      if (viewport && viewport.scale !== 1) return;
      const height = mobile ? viewport?.height ?? window.innerHeight : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      const editing = document.activeElement?.matches("input, textarea, [contenteditable=true]");
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        restingHeight = window.innerHeight;
      } else if (!editing) {
        restingHeight = Math.max(restingHeight, height);
      }
      document.documentElement.dataset.keyboard = mobile && editing && height < restingHeight - 120 ? "open" : "closed";
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.documentElement.style.removeProperty("--app-height");
      delete document.documentElement.dataset.keyboard;
    };
  }, []);
}
