import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "../../lib/socket";
import { getOutput, setOutput, appendOutput } from "../../lib/outputBuffer";
import { extractMdPaths, renderOutputHtml } from "../../lib/ansi";
import { MdLinksBar } from "./MdLinksBar";

interface TerminalProps {
  executionId: string | null;
  base?: string;
}

export function Terminal({ executionId, base }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");
  const [mdPaths, setMdPaths] = useState<string[]>([]);
  const autoScrollRef = useRef(true);

  const render = useCallback((text: string) => {
    setHtml(renderOutputHtml(text || "(sem output)"));
    const paths = extractMdPaths(text);
    if (paths.length > 0) setMdPaths(paths);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [html]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 40;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setHtml("");
    setMdPaths([]);
    autoScrollRef.current = true;

    if (!executionId) return;

    const buffered = getOutput(executionId);
    if (buffered) render(buffered);

    const socket = getSocket();
    socket.emit("subscribe:execution", executionId);

    const catchupHandler = (data: { id: string; output: string }) => {
      if (data.id !== executionId) return;
      const current = getOutput(executionId);
      if (data.output.length > current.length) {
        setOutput(executionId, data.output);
        render(data.output);
      }
    };

    const chunkHandler = (data: { id: string; chunk: string }) => {
      if (data.id !== executionId) return;
      appendOutput(data.id, data.chunk);
      render(getOutput(executionId));
    };

    socket.on("execution:catchup", catchupHandler);
    socket.on("execution:output", chunkHandler);

    return () => {
      socket.off("execution:catchup", catchupHandler);
      socket.off("execution:output", chunkHandler);
      socket.emit("unsubscribe:execution", executionId);
    };
  }, [executionId, render]);

  return (
    <div className="flex flex-col w-full h-full min-h-[300px]">
      <div
        ref={containerRef}
        className="activity-output flex-1 rounded-md overflow-auto bg-bg p-3 md:p-4 text-sm text-text-primary min-h-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {base && <MdLinksBar paths={mdPaths} base={base} />}
    </div>
  );
}
