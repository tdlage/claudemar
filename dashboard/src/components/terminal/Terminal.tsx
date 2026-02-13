import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";
import { getOutput, setOutput, appendOutput } from "../../lib/outputBuffer";

function formatBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "\x1b[1m$1\x1b[22m");
}

interface TerminalProps {
  executionId: string | null;
}

export function Terminal({ executionId }: TerminalProps) {
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
        cyan: "#22d3ee",
        yellow: "#facc15",
        green: "#4ade80",
        magenta: "#c084fc",
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

    if (!executionId) return;

    const buffered = getOutput(executionId);
    if (buffered) {
      term.write(formatBold(buffered));
    }

    const socket = getSocket();
    socket.emit("subscribe:execution", executionId);

    const catchupHandler = (data: { id: string; output: string }) => {
      if (data.id !== executionId) return;
      const current = getOutput(executionId);
      if (data.output.length > current.length) {
        setOutput(executionId, data.output);
        term.clear();
        term.write(formatBold(data.output));
      }
    };

    const chunkHandler = (data: { id: string; chunk: string }) => {
      if (data.id !== executionId) return;
      appendOutput(data.id, data.chunk);
      term.write(formatBold(data.chunk));
    };

    socket.on("execution:catchup", catchupHandler);
    socket.on("execution:output", chunkHandler);

    return () => {
      socket.off("execution:catchup", catchupHandler);
      socket.off("execution:output", chunkHandler);
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
