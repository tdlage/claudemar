import { useEffect, useRef, useState } from "react";

interface SelectionSafeHtmlProps {
  html: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function selectionInside(el: HTMLElement | null): boolean {
  const sel = window.getSelection();
  return !!(
    sel &&
    !sel.isCollapsed &&
    el &&
    (el.contains(sel.anchorNode) || el.contains(sel.focusNode))
  );
}

export function SelectionSafeHtml({ html, className, onClick }: SelectionSafeHtmlProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(html);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (html === rendered) return;
    if (selectionInside(ref.current)) {
      pendingRef.current = html;
      return;
    }
    pendingRef.current = null;
    setRendered(html);
  }, [html, rendered]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (pendingRef.current === null) return;
      if (selectionInside(ref.current)) return;
      const pending = pendingRef.current;
      pendingRef.current = null;
      setRendered(pending);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: rendered }}
      onClick={onClick}
    />
  );
}
