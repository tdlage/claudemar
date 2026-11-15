export interface Point {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
  side: 1 | -1;
}

const ARC_STEPS = 10;
const LEVEL_ITERATIONS = 24;

export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function clipBelow(points: readonly Point[], level: number): Point[] {
  const clipped: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const aInside = a.y >= level;
    if (aInside) clipped.push(a);
    if (aInside !== b.y >= level) {
      const t = (level - a.y) / (b.y - a.y);
      clipped.push({ x: a.x + (b.x - a.x) * t, y: level });
    }
  }
  return clipped;
}

export function areaBelow(points: readonly Point[], level: number): number {
  return polygonArea(clipBelow(points, level));
}

export function levelForArea(points: readonly Point[], area: number): number {
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  if (area <= 0) return bottom;
  let high = top;
  let low = bottom;
  for (let i = 0; i < LEVEL_ITERATIONS; i++) {
    const middle = (high + low) / 2;
    if (areaBelow(points, middle) > area) high = middle;
    else low = middle;
  }
  return (high + low) / 2;
}

function unitRatio(capacity: number): number {
  return [0.95, 0.95, 0.95, 0.85, 0.75, 0.66, 0.6, 0.55][Math.min(capacity, 7)];
}

function roundedCup(halfWidth: number, depth: number, radius: number): Point[] {
  const points: Point[] = [{ x: -halfWidth, y: 0 }, { x: -halfWidth, y: depth - radius }];
  for (let i = 1; i <= ARC_STEPS; i++) {
    const angle = Math.PI - (i / ARC_STEPS) * (Math.PI / 2);
    points.push({ x: -halfWidth + radius + Math.cos(angle) * radius, y: depth - radius + Math.sin(angle) * radius });
  }
  for (let i = 0; i <= ARC_STEPS; i++) {
    const angle = Math.PI / 2 - (i / ARC_STEPS) * (Math.PI / 2);
    points.push({ x: halfWidth - radius + Math.cos(angle) * radius, y: depth - radius + Math.sin(angle) * radius });
  }
  points.push({ x: halfWidth, y: 0 });
  return points;
}

export class TubeShape {
  readonly width: number;
  readonly capacity: number;
  readonly wall: number;
  readonly inner: number;
  readonly unit: number;
  readonly depth: number;
  readonly height: number;
  readonly rim: number;
  readonly lip: number;
  readonly interior: Point[];
  readonly outline: Point[];

  constructor(width: number, capacity: number) {
    this.width = width;
    this.capacity = capacity;
    this.wall = Math.max(1.5, width * 0.055);
    this.inner = width - this.wall * 2;
    this.unit = width * unitRatio(capacity);
    this.depth = width * 0.5 + this.unit * capacity;
    this.height = this.depth + this.wall;
    this.rim = Math.max(3, width * 0.13);
    this.lip = Math.max(1.5, width * 0.07);
    const innerRadius = (this.inner / 2) * 0.9;
    this.interior = roundedCup(this.inner / 2, this.depth, innerRadius);
    this.outline = roundedCup(width / 2, this.height, innerRadius + this.wall);
  }

  static aspect(capacity: number): number {
    return new TubeShape(100, capacity).height / 100;
  }

  surface(units: number): number {
    return this.depth - units * this.unit;
  }

  area(units: number): number {
    return areaBelow(this.interior, this.surface(units));
  }

  anchor(side: 1 | -1): number {
    return (side * this.inner) / 2;
  }

  toWorld(pose: Pose, point: Point): Point {
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const x = point.x - this.anchor(pose.side);
    return { x: pose.x + x * cos - point.y * sin, y: pose.y + x * sin + point.y * cos };
  }

  toLocal(pose: Pose, point: Point): Point {
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const dx = point.x - pose.x;
    const dy = point.y - pose.y;
    return { x: dx * cos + dy * sin + this.anchor(pose.side), y: -dx * sin + dy * cos };
  }
}

export function trace(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.closePath();
}
