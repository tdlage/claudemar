import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";

interface RunTerminalProps {
  configId: string;
}

export function RunTerminal({ configId }: RunTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

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
        red: "#f87171",
        magenta: "#c084fc",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try {
      fitAddon.fit();
    } catch {
      // container not ready
    }

    termRef.current = term;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
      }
    });
    resizeObserver.observe(containerRef.current);

    const socket = getSocket();
    socket.emit("subscribe:run", configId);

    const catchupHandler = (data: { configId: string; output: string }) => {
      if (data.configId !== configId) return;
      term.write(data.output);
    };

    const outputHandler = (data: { configId: string; chunk: string }) => {
      if (data.configId !== configId) return;
      term.write(data.chunk);
    };

    const stopHandler = (data: { configId: string; exitCode: number }) => {
      if (data.configId !== configId) return;
      term.write(`\r\n\x1b[90m--- Process exited with code ${data.exitCode} ---\x1b[0m\r\n`);
    };

    const errorHandler = (data: { configId: string; error: string }) => {
      if (data.configId !== configId) return;
      term.write(`\r\n\x1b[31m--- Error: ${data.error} ---\x1b[0m\r\n`);
    };

    socket.on("run:catchup", catchupHandler);
    socket.on("run:output", outputHandler);
    socket.on("run:stop", stopHandler);
    socket.on("run:error", errorHandler);

    return () => {
      socket.off("run:catchup", catchupHandler);
      socket.off("run:output", outputHandler);
      socket.off("run:stop", stopHandler);
      socket.off("run:error", errorHandler);
      socket.emit("unsubscribe:run", configId);
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [configId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px] overflow-hidden bg-bg"
    />
  );
}
