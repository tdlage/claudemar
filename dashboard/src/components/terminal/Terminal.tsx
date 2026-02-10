import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";

interface TerminalProps {
  executionId: string | null;
  initialOutput?: string;
}

export function Terminal({ executionId, initialOutput }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0a0a0a",
        foreground: "#e4e4e7",
        cursor: "#6366f1",
        selectionBackground: "#6366f133",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try { fitAddon.fit(); } catch { /* container not ready */ }

    termRef.current = term;
    fitRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.clear();
    if (initialOutput) {
      term.write(initialOutput);
    }
  }, [executionId, initialOutput]);

  useEffect(() => {
    if (!executionId) return;

    const socket = getSocket();
    socket.emit("subscribe:execution", executionId);

    const handler = (data: { id: string; chunk: string }) => {
      if (data.id === executionId && termRef.current) {
        termRef.current.write(data.chunk);
      }
    };

    socket.on("execution:output", handler);

    return () => {
      socket.off("execution:output", handler);
      socket.emit("unsubscribe:execution", executionId);
    };
  }, [executionId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[300px] rounded-md overflow-hidden bg-bg"
    />
  );
}
