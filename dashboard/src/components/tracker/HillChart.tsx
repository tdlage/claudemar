import { useRef, useState, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { TrackerScope } from "../../lib/types";

interface Props {
  scopes: TrackerScope[];
  onRefresh: () => void;
}

const W = 600;
const H = 200;
const PADDING = 30;

function hillY(x: number): number {
  const normalized = x / W;
  return H - PADDING - (H - PADDING * 2) * Math.sin(normalized * Math.PI);
}

function posToX(hillPosition: number): number {
  return PADDING + (hillPosition / 100) * (W - PADDING * 2);
}

function xToPos(x: number): number {
  const pos = ((x - PADDING) / (W - PADDING * 2)) * 100;
  return Math.max(0, Math.min(100, Math.round(pos)));
}

const STATUS_COLORS: Record<string, string> = {
  uphill: "#60a5fa",
  overhill: "#f59e0b",
  done: "#22c55e",
};

export function HillChart({ scopes, onRefresh }: Props) {
  const { addToast } = useToast();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [hoveredScope, setHoveredScope] = useState<string | null>(null);

  const hillPath = Array.from({ length: 101 }, (_, i) => {
    const x = PADDING + (i / 100) * (W - PADDING * 2);
    const y = hillY(x);
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");

  const getSvgX = useCallback((e: React.MouseEvent) => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    return (e.clientX - rect.left) * (W / rect.width);
  }, []);

  const handleMouseDown = (scopeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(scopeId);
    setDragX(getSvgX(e));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setDragX(getSvgX(e));
  };

  const handleMouseUp = async () => {
    if (!dragging) return;
    const newPos = xToPos(dragX);
    setDragging(null);
    try {
      await api.patch(`/tracker/scopes/${dragging}/hill`, { hillPosition: newPos });
      onRefresh();
    } catch {
      addToast("error", "Failed to update hill position");
    }
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <line x1={W / 2} y1={PADDING - 10} x2={W / 2} y2={H - PADDING + 10} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4" />
        <text x={W / 4} y={H - 5} textAnchor="middle" className="fill-text-muted" fontSize={10}>Figuring it out</text>
        <text x={(3 * W) / 4} y={H - 5} textAnchor="middle" className="fill-text-muted" fontSize={10}>Making it happen</text>

        <path d={hillPath} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={2} />

        {scopes.map((scope) => {
          const isDragging = dragging === scope.id;
          const x = isDragging ? dragX : posToX(scope.hillPosition);
          const y = hillY(x);
          const color = STATUS_COLORS[scope.status] ?? STATUS_COLORS.uphill;
          const isHovered = hoveredScope === scope.id;

          return (
            <g key={scope.id}>
              <circle
                cx={x}
                cy={y}
                r={isDragging ? 8 : isHovered ? 7 : 6}
                fill={color}
                stroke={isDragging ? "white" : "none"}
                strokeWidth={2}
                className="cursor-grab active:cursor-grabbing transition-all"
                onMouseDown={(e) => handleMouseDown(scope.id, e)}
                onMouseEnter={() => setHoveredScope(scope.id)}
                onMouseLeave={() => setHoveredScope(null)}
              />
              <text
                x={x}
                y={y - 12}
                textAnchor="middle"
                className="fill-text-secondary pointer-events-none"
                fontSize={9}
                opacity={isDragging || isHovered ? 1 : 0.7}
              >
                {scope.title.length > 20 ? scope.title.slice(0, 18) + "..." : scope.title}
              </text>
              {(isDragging || isHovered) && (
                <text
                  x={x}
                  y={y + 18}
                  textAnchor="middle"
                  className="fill-text-muted pointer-events-none"
                  fontSize={8}
                >
                  {isDragging ? xToPos(dragX) : scope.hillPosition}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {scopes.length === 0 && (
        <p className="text-center text-sm text-text-muted py-4">Add scopes to see them on the hill chart</p>
      )}
    </div>
  );
}
