import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import type { DecantaController, GameSnapshot } from "./controller";
import { isComplete } from "./engine";
import { LIQUIDS, withAlpha } from "./palette";
import { BoardRenderer, type RendererTheme, type TubeRect } from "./renderer";

interface Props {
  controller: DecantaController;
  snapshot: GameSnapshot;
  paused: boolean;
  symbols: boolean;
}

const MAX_PIXEL_RATIO = 2.5;

function readTheme(): RendererTheme {
  const styles = getComputedStyle(document.documentElement);
  const text = styles.getPropertyValue("--dt-text").trim() || "#edf5eb";
  return {
    dark: document.documentElement.dataset.theme !== "paper",
    glass: withAlpha(text, 0.42),
    accent: styles.getPropertyValue("--dt-brand").trim() || "#b8dca6",
  };
}

function describe(tube: number[], capacity: number, index: number): string {
  const name = `Frasco ${index + 1}`;
  if (tube.length === 0) return `${name}, vazio`;
  const colors = tube.map((color) => LIQUIDS[color].name).join(", ");
  if (isComplete(tube, capacity)) return `${name}, completo de ${LIQUIDS[tube[0]].name}`;
  const free = capacity - tube.length;
  return `${name}: ${colors}, de baixo para cima; ${free === 0 ? "cheio" : `${free} ${free === 1 ? "espaço livre" : "espaços livres"}`}`;
}

export function GameBoard({ controller, snapshot, paused, symbols }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [rects, setRects] = useState<TubeRect[]>([]);
  const { theme } = useTheme();

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!frame || !canvas || !ctx) return;
    const renderer = new BoardRenderer(canvas, ctx, {
      layout: setRects,
      pour: (duration, fillFrom, fillTo) => controller.playPour(duration, fillFrom, fillTo),
      seal: () => controller.playSeal(),
    }, readTheme());
    renderer.setReducedMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const resize = () => {
      const bounds = frame.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    rendererRef.current = renderer;
    renderer.start();
    controller.attach(renderer);
    return () => {
      observer.disconnect();
      controller.attach(null);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [controller]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (paused) renderer.stop();
    else renderer.start();
  }, [paused]);

  useEffect(() => {
    rendererRef.current?.setTheme(readTheme());
  }, [theme]);

  useEffect(() => {
    rendererRef.current?.setSymbols(symbols);
  }, [symbols]);

  const interactive = snapshot.phase === "playing";

  return (
    <div ref={frameRef} className="decanta-board">
      <canvas ref={canvasRef} className="decanta-canvas" aria-hidden="true" />
      <div className="decanta-hits" role="group" aria-label="Frascos">
        {rects.map((rect, index) => {
          const tube = snapshot.tubes[index];
          if (!tube) return null;
          return (
            <button
              key={index}
              type="button"
              className="decanta-hit"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              aria-label={describe(tube, snapshot.capacity, index)}
              aria-pressed={snapshot.selected === index}
              disabled={!interactive}
              onClick={() => controller.tap(index)}
            />
          );
        })}
      </div>
    </div>
  );
}
