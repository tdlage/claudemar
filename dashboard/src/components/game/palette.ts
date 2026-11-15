interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Liquid {
  name: string;
  base: string;
  light: string;
  deep: string;
  cap: string;
  ink: string;
}

const SOURCES: ReadonlyArray<readonly [name: string, hex: string]> = [
  ["vermelho", "#e5484d"],
  ["azul", "#3b82f6"],
  ["amarelo", "#f7c934"],
  ["verde", "#1fa971"],
  ["roxo", "#9054d6"],
  ["laranja", "#f5822a"],
  ["ciano", "#2cc4d9"],
  ["rosa", "#f48fc4"],
  ["marrom", "#8d5b33"],
  ["lima", "#a6d84a"],
  ["pérola", "#ece7dc"],
  ["grafite", "#6b7686"],
];

function parse(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: Math.round(color.r + (target.r - color.r) * amount),
    g: Math.round(color.g + (target.g - color.g) * amount),
    b: Math.round(color.b + (target.b - color.b) * amount),
  };
}

function css({ r, g, b }: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

export const LIQUIDS: Liquid[] = SOURCES.map(([name, hex]) => {
  const rgb = parse(hex);
  return {
    name,
    base: css(rgb),
    light: css(mix(rgb, WHITE, 0.32)),
    deep: css(mix(rgb, BLACK, 0.28)),
    cap: css(mix(rgb, BLACK, 0.42)),
    ink: luminance(rgb) > 0.6 ? "rgb(20 28 24 / 0.72)" : "rgb(255 255 255 / 0.86)",
  };
});

export function withAlpha(color: string, alpha: number): string {
  const rgb = color.startsWith("#") ? parse(color) : rgbOf(color);
  return css(rgb, alpha);
}

function rgbOf(color: string): Rgb {
  const [r, g, b] = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
  return { r, g, b };
}

function polygon(ctx: CanvasRenderingContext2D, points: number, radius: number, rotation: number, cx: number, cy: number): void {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const angle = rotation + (i * Math.PI * 2) / points;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawSymbol(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, size: number, color: string): void {
  const r = size / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.2);
  ctx.lineCap = "round";
  switch (index % SOURCES.length) {
    case 0:
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1:
      ctx.fillRect(cx - r * 0.72, cy - r * 0.72, r * 1.44, r * 1.44);
      break;
    case 2:
      polygon(ctx, 3, r, -Math.PI / 2, cx, cy + r * 0.12);
      break;
    case 3:
      polygon(ctx, 4, r, -Math.PI / 2, cx, cy);
      break;
    case 4:
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const radius = i % 2 === 0 ? r : r * 0.45;
        ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 5:
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy);
      ctx.lineTo(cx + r * 0.8, cy);
      ctx.moveTo(cx, cy - r * 0.8);
      ctx.lineTo(cx, cy + r * 0.8);
      ctx.stroke();
      break;
    case 6:
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 7:
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy - r * 0.62);
      ctx.lineTo(cx + r * 0.62, cy + r * 0.62);
      ctx.moveTo(cx + r * 0.62, cy - r * 0.62);
      ctx.lineTo(cx - r * 0.62, cy + r * 0.62);
      ctx.stroke();
      break;
    case 8:
      polygon(ctx, 6, r * 0.9, 0, cx, cy);
      break;
    case 9:
      polygon(ctx, 3, r, Math.PI / 2, cx, cy - r * 0.12);
      break;
    case 10:
      ctx.beginPath();
      ctx.arc(cx - r * 0.45, cy, r * 0.32, 0, Math.PI * 2);
      ctx.moveTo(cx + r * 0.77, cy);
      ctx.arc(cx + r * 0.45, cy, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      for (const offset of [-0.55, 0, 0.55]) {
        ctx.moveTo(cx - r * 0.75, cy + r * offset);
        ctx.lineTo(cx + r * 0.75, cy + r * offset);
      }
      ctx.stroke();
  }
  ctx.restore();
}
