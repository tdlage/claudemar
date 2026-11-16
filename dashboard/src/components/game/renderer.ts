import { isComplete } from "./engine";
import { TubeShape, levelForArea, trace, type Point, type Pose } from "./geometry";
import { LIQUIDS, drawSymbol, withAlpha } from "./palette";
import type { Tube } from "./types";

export interface TubeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RendererTheme {
  dark: boolean;
  glass: string;
  accent: string;
}

export interface RendererEvents {
  layout(rects: TubeRect[]): void;
  pour(durationMs: number, fillFrom: number, fillTo: number): void;
  seal(index: number): void;
}

interface Layer {
  color: number;
  amount: number;
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  speed: number;
}

interface Sprite {
  layers: Layer[];
  restX: number;
  restY: number;
  lift: number;
  liftVelocity: number;
  pose: Pose | null;
  front: boolean;
  wobble: number;
  phase: number;
  sealed: number;
  capDrop: number;
  glow: number;
  shake: number;
  intro: number;
  reserved: number;
  queue: Promise<void>;
  bubbles: Bubble[];
}

interface Stream {
  x: number;
  top: number;
  bottom: number;
  color: number;
  width: number;
}

interface Particle {
  kind: "drop" | "spark" | "confetti";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
}

interface Tween {
  start: number;
  duration: number;
  ease: (t: number) => number;
  update: (progress: number) => void;
  resolve: () => void;
}

const GAP_X = 0.62;
const ROW_GAP = 0.28;
const HEADROOM_WIDTHS = 1.6;
const HEADROOM_HEIGHTS = 0.12;
const FOOT_WIDTHS = 0.5;
const EDGE = 0.035;
const MAX_WIDTH = 86;
const MIN_WIDTH = 16;
const LIFT = 0.16;
const MAX_STEP_MS = 32;

const linear = (t: number) => t;
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

function easeOutBounce(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function total(layers: readonly Layer[]): number {
  return layers.reduce((sum, layer) => sum + layer.amount, 0);
}

function layersOf(tube: Tube): Layer[] {
  const layers: Layer[] = [];
  for (const color of tube) {
    const last = layers[layers.length - 1];
    if (last && last.color === color) last.amount += 1;
    else layers.push({ color, amount: 1 });
  }
  return layers;
}

function unitsOf(layers: readonly Layer[]): number[] {
  return layers.flatMap((layer) => Array<number>(Math.round(layer.amount)).fill(layer.color));
}

function drained(layers: readonly Layer[], amount: number): Layer[] {
  const next = layers.map((layer) => ({ ...layer }));
  let remaining = amount;
  while (remaining > 1e-6 && next.length > 0) {
    const top = next[next.length - 1];
    const taken = Math.min(top.amount, remaining);
    top.amount -= taken;
    remaining -= taken;
    if (top.amount <= 1e-6) next.pop();
  }
  return next;
}

function filled(layers: readonly Layer[], color: number, amount: number): Layer[] {
  const next = layers.map((layer) => ({ ...layer }));
  if (amount <= 1e-6) return next;
  const top = next[next.length - 1];
  if (top && top.color === color) top.amount += amount;
  else next.push({ color, amount });
  return next;
}

function pourAngle(fill: number): number {
  return ((96 - 44 * Math.max(0, Math.min(1, fill))) * Math.PI) / 180;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

export class BoardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private sprites: Sprite[] = [];
  private shape = new TubeShape(40, 4);
  private capacity = 4;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private selected: number | null = null;
  private tweens: Tween[] = [];
  private streams = new Set<Stream>();
  private particles: Particle[] = [];
  private fills = new Map<number, CanvasGradient>();
  private glossFills: { gloss: CanvasGradient; shade: CanvasGradient } | null = null;
  private frameId = 0;
  private last = 0;
  private now = 0;
  private running = false;
  private generation = 0;
  private symbols = false;
  private reducedMotion = false;
  private theme: RendererTheme;
  private readonly canvas: HTMLCanvasElement;
  private readonly events: RendererEvents;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, events: RendererEvents, theme: RendererTheme) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.events = events;
    this.theme = theme;
  }

  setTheme(theme: RendererTheme): void {
    this.theme = theme;
    this.glossFills = null;
    this.draw();
  }

  setSymbols(enabled: boolean): void {
    this.symbols = enabled;
    this.draw();
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.layout();
    this.draw();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  destroy(): void {
    this.stop();
    this.finishTweens();
  }

  load(tubes: Tube[], capacity: number, intro: boolean): void {
    this.generation += 1;
    this.finishTweens();
    this.streams.clear();
    this.capacity = capacity;
    this.selected = null;
    this.sprites = tubes.map((tube) => ({
      layers: layersOf(tube),
      restX: 0,
      restY: 0,
      lift: 0,
      liftVelocity: 0,
      pose: null,
      front: false,
      wobble: 0,
      phase: Math.random() * Math.PI * 2,
      sealed: isComplete(tube, capacity) ? 1 : 0,
      capDrop: 1,
      glow: 0,
      shake: 0,
      intro: intro && !this.reducedMotion ? 0 : 1,
      reserved: 0,
      queue: Promise.resolve(),
      bubbles: [],
    }));
    this.layout();
    if (intro && !this.reducedMotion) {
      this.sprites.forEach((sprite, i) => {
        void this.tween(460, easeOutBack, (p) => (sprite.intro = p), i * 45);
      });
    }
    this.draw();
  }

  select(index: number | null): void {
    this.selected = index;
  }

  reject(index: number): void {
    const sprite = this.sprites[index];
    if (sprite) sprite.shake = 380;
  }

  idle(): Promise<void> {
    return Promise.all(this.sprites.map((sprite) => sprite.queue)).then(() => undefined);
  }

  pour(from: number, to: number, amount: number): Promise<void> {
    const source = this.sprites[from];
    const target = this.sprites[to];
    if (!source || !target) return Promise.resolve();
    const generation = this.generation;
    const alive = () => generation === this.generation;
    const targetReady = deferred();
    source.reserved += 1;
    const finished = Promise.all([source.queue, target.queue]).then(async () => {
      source.reserved -= 1;
      if (alive()) await this.animatePour(source, target, to, amount, alive, targetReady.resolve);
      targetReady.resolve();
    });
    target.queue = targetReady.promise;
    source.queue = finished;
    return finished;
  }

  rewind(from: number, to: number, amount: number): Promise<void> {
    const origin = this.sprites[from];
    const poured = this.sprites[to];
    if (!origin || !poured) return Promise.resolve();
    const generation = this.generation;
    const finished = Promise.all([origin.queue, poured.queue]).then(async () => {
      if (generation === this.generation) await this.animateRewind(origin, poured, amount);
    });
    origin.queue = finished;
    poured.queue = finished;
    return finished;
  }

  celebrate(): void {
    if (this.reducedMotion) return;
    const colors = [...new Set(this.sprites.flatMap((sprite) => sprite.layers.map((layer) => LIQUIDS[layer.color].base)))];
    colors.push(this.theme.accent);
    for (let i = 0; i < 130; i++) {
      this.particles.push({
        kind: "confetti",
        x: Math.random() * this.width,
        y: -10 - Math.random() * this.height * 0.4,
        vx: (Math.random() - 0.5) * 0.12,
        vy: 0.06 + Math.random() * 0.14,
        life: 0,
        maxLife: 2200 + Math.random() * 1400,
        size: 5 + Math.random() * 5,
        color: colors[i % colors.length],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.02,
      });
    }
    this.sprites.forEach((sprite, i) => {
      void this.tween(1, linear, () => {
        sprite.liftVelocity += 0.02;
        sprite.glow = 1;
      }, 120 + i * 70);
    });
  }

  private duration(ms: number): number {
    return this.reducedMotion ? ms * 0.3 : ms;
  }

  private tween(duration: number, ease: (t: number) => number, update: (progress: number) => void, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ start: this.now + delay, duration: this.duration(duration), ease, update, resolve });
      if (!this.running) {
        update(1);
        this.tweens.pop();
        resolve();
      }
    });
  }

  private finishTweens(): void {
    const pending = this.tweens;
    this.tweens = [];
    for (const tween of pending) {
      tween.update(1);
      tween.resolve();
    }
  }

  private restPose(sprite: Sprite, side: 1 | -1, lift = sprite.lift): Pose {
    const shake = sprite.shake > 0 ? Math.sin(sprite.shake * 0.075) * Math.min(6, this.shape.width * 0.14) * (sprite.shake / 380) : 0;
    return {
      x: sprite.restX + this.shape.anchor(side) + shake,
      y: sprite.restY - lift * this.shape.height * LIFT + (1 - sprite.intro) * 22,
      angle: 0,
      side,
    };
  }

  private pourPose(target: Sprite, side: 1 | -1, fill: number): Pose {
    const gap = this.shape.width * 0.42 + 4;
    return {
      x: target.restX - side * this.shape.inner * 0.08,
      y: target.restY - this.shape.rim - gap,
      angle: side * pourAngle(fill),
      side,
    };
  }

  private pourSide(source: Sprite, target: Sprite): 1 | -1 {
    const preferred: 1 | -1 = Math.abs(source.restX - target.restX) < 1
      ? (target.restX > this.width / 2 ? 1 : -1)
      : source.restX < target.restX ? 1 : -1;
    const reach = this.shape.height * 0.98;
    const fits = (side: 1 | -1) => (side === 1 ? target.restX - reach >= 0 : target.restX + reach <= this.width);
    return fits(preferred) || !fits(preferred === 1 ? -1 : 1) ? preferred : preferred === 1 ? -1 : 1;
  }

  private async animatePour(source: Sprite, target: Sprite, targetIndex: number, amount: number, alive: () => boolean, release: () => void): Promise<void> {
    const capacity = this.capacity;
    const color = source.layers[source.layers.length - 1]?.color;
    if (color === undefined) return;
    const side = this.pourSide(source, target);
    const sourceUnits = total(source.layers);
    const targetUnits = total(target.layers);
    const sourceStart = source.layers;
    const targetStart = target.layers;
    const startPose = this.restPose(source, side);
    source.front = true;
    source.pose = startPose;

    await this.tween(340, easeInOut, (p) => {
      const goal = this.pourPose(target, side, sourceUnits / capacity);
      source.pose = { x: lerp(startPose.x, goal.x, p), y: lerp(startPose.y, goal.y, p), angle: lerp(0, goal.angle, p), side };
      source.wobble = Math.max(source.wobble, 1.5 * p);
    });
    if (!alive()) return;

    const pourMs = this.duration(240 + 120 * amount);
    this.events.pour(pourMs, targetUnits / capacity, (targetUnits + amount) / capacity);
    const stream: Stream = { x: 0, top: 0, bottom: 0, color, width: Math.max(3, this.shape.inner * 0.22) };
    this.streams.add(stream);
    let lastDrop = 0;
    await this.tween(240 + 120 * amount, linear, (p) => {
      const moved = amount * p;
      source.layers = drained(sourceStart, moved);
      target.layers = filled(targetStart, color, moved);
      source.pose = this.pourPose(target, side, (sourceUnits - moved) / capacity);
      const lip = source.pose;
      const surface = target.restY + this.shape.surface(targetUnits + moved);
      stream.x = lip.x + side * 1.5;
      stream.top = lip.y;
      stream.bottom = lerp(lip.y, surface, Math.min(1, p / 0.1));
      target.wobble = Math.max(target.wobble, 1.2 + this.shape.width * 0.05);
      if (!this.reducedMotion && this.now - lastDrop > 45) {
        lastDrop = this.now;
        this.splash(stream.x, surface, color);
        this.bubble(target);
      }
    });
    if (!alive()) return;

    source.layers = drained(sourceStart, amount);
    target.layers = filled(targetStart, color, amount);
    const tailTop = stream.top;
    void this.tween(130, easeIn, (p) => (stream.top = lerp(tailTop, stream.bottom, p))).then(() => this.streams.delete(stream));
    if (isComplete(unitsOf(target.layers), capacity)) this.seal(target, targetIndex);
    release();

    const pourEnd = source.pose;
    await this.tween(330, easeOut, (p) => {
      const lift = source.reserved > 0 ? 1 : 0;
      const home = this.restPose(source, side, lift);
      source.pose = { x: lerp(pourEnd.x, home.x, p), y: lerp(pourEnd.y, home.y, p), angle: lerp(pourEnd.angle, 0, p), side };
    });
    if (!alive()) return;
    source.lift = source.reserved > 0 ? 1 : 0;
    source.liftVelocity = 0;
    source.pose = null;
    source.front = false;
    source.wobble = Math.max(source.wobble, 2.5);
  }

  private async animateRewind(origin: Sprite, poured: Sprite, amount: number): Promise<void> {
    const color = poured.layers[poured.layers.length - 1]?.color;
    if (color === undefined) return;
    const originStart = origin.layers;
    const pouredStart = poured.layers;
    if (poured.sealed > 0) {
      const sealed = poured.sealed;
      poured.glow = 0;
      void this.tween(200, easeOut, (p) => (poured.sealed = sealed * (1 - p)));
    }
    await this.tween(200 + 60 * amount, easeInOut, (p) => {
      poured.layers = drained(pouredStart, amount * p);
      origin.layers = filled(originStart, color, amount * p);
    });
    poured.layers = drained(pouredStart, amount);
    origin.layers = filled(originStart, color, amount);
    origin.wobble = Math.max(origin.wobble, 2);
    poured.wobble = Math.max(poured.wobble, 2);
  }

  private seal(sprite: Sprite, index: number): void {
    sprite.sealed = 1;
    sprite.capDrop = 0;
    sprite.glow = 1;
    this.events.seal(index);
    void this.tween(520, linear, (p) => (sprite.capDrop = p));
    if (this.reducedMotion) return;
    const color = LIQUIDS[sprite.layers[sprite.layers.length - 1]?.color ?? 0];
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const speed = 0.05 + Math.random() * 0.08;
      this.particles.push({
        kind: "spark",
        x: sprite.restX,
        y: sprite.restY - this.shape.rim,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.04,
        life: 0,
        maxLife: 520 + Math.random() * 260,
        size: 3 + Math.random() * 4,
        color: i % 3 === 0 ? "rgb(255 255 255)" : color.light,
        rotation: 0,
        spin: 0,
      });
    }
  }

  private splash(x: number, y: number, color: number): void {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        kind: "drop",
        x: x + (Math.random() - 0.5) * 4,
        y,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -0.08 - Math.random() * 0.1,
        life: 0,
        maxLife: 260 + Math.random() * 160,
        size: 1.2 + Math.random() * 1.6,
        color: LIQUIDS[color].light,
        rotation: 0,
        spin: 0,
      });
    }
  }

  private bubble(sprite: Sprite): void {
    if (sprite.bubbles.length > 14) return;
    sprite.bubbles.push({
      x: (Math.random() - 0.5) * this.shape.inner * 0.7,
      y: this.shape.depth - this.shape.unit * 0.3,
      radius: 0.8 + Math.random() * Math.max(1, this.shape.width * 0.045),
      speed: 0.05 + Math.random() * 0.07,
    });
  }

  private layout(): void {
    const count = this.sprites.length;
    if (count === 0 || this.width === 0) return;
    const aspect = TubeShape.aspect(this.capacity);
    const headroom = HEADROOM_WIDTHS + aspect * HEADROOM_HEIGHTS;
    const edge = Math.max(14, this.width * EDGE);
    let best = { rows: 1, width: 0 };
    for (let rows = 1; rows <= Math.min(4, count); rows++) {
      const perRow = Math.ceil(count / rows);
      const byWidth = (this.width - edge * 2) / (perRow + (perRow - 1) * GAP_X);
      const byHeight = (this.height - 8) / (headroom + rows * aspect + (rows - 1) * ROW_GAP * aspect + FOOT_WIDTHS);
      const width = Math.min(byWidth, byHeight, MAX_WIDTH);
      if (width > best.width * 1.04) best = { rows, width };
    }
    const width = Math.max(MIN_WIDTH, best.width);
    this.shape = new TubeShape(width, this.capacity);
    this.fills.clear();
    this.glossFills = null;
    const shape = this.shape;
    const rowGap = shape.height * ROW_GAP;
    const blockHeight = width * (headroom + FOOT_WIDTHS) + best.rows * shape.height + (best.rows - 1) * rowGap;
    const top = Math.max(0, (this.height - blockHeight) / 2) + width * headroom;
    const base = Math.floor(count / best.rows);
    const extra = count % best.rows;
    const rects: TubeRect[] = [];
    let index = 0;
    for (let row = 0; row < best.rows; row++) {
      const inRow = base + (row < extra ? 1 : 0);
      const rowWidth = inRow * width + (inRow - 1) * width * GAP_X;
      const left = (this.width - rowWidth) / 2 + width / 2;
      const mouth = top + row * (shape.height + rowGap);
      for (let column = 0; column < inRow; column++, index++) {
        const sprite = this.sprites[index];
        sprite.restX = left + column * width * (1 + GAP_X);
        sprite.restY = mouth;
        const padX = (width * GAP_X) / 2;
        rects.push({
          x: sprite.restX - width / 2 - padX,
          y: mouth - shape.rim - shape.height * LIFT,
          width: width + padX * 2,
          height: shape.height + shape.rim + shape.height * LIFT + 6,
        });
      }
    }
    this.events.layout(rects);
  }

  private frame = (time: number) => {
    if (!this.running) return;
    const elapsed = Math.min(MAX_STEP_MS * 4, time - this.last);
    this.last = time;
    this.now += elapsed;
    this.step(Math.min(MAX_STEP_MS, elapsed));
    this.draw();
    this.frameId = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    const active = this.tweens;
    this.tweens = [];
    for (const tween of active) {
      const progress = Math.min(1, Math.max(0, (this.now - tween.start) / tween.duration));
      if (this.now < tween.start) {
        this.tweens.push(tween);
        continue;
      }
      tween.update(tween.ease(progress));
      if (progress >= 1) tween.resolve();
      else this.tweens.push(tween);
    }
    this.sprites.forEach((sprite, index) => {
      if (!sprite.pose) {
        const goal = this.selected === index || sprite.reserved > 0 ? 1 : 0;
        if (this.reducedMotion) {
          sprite.lift = goal;
          sprite.liftVelocity = 0;
        } else {
          sprite.liftVelocity += (0.00065 * (goal - sprite.lift) - 0.042 * sprite.liftVelocity) * dt;
          sprite.lift += sprite.liftVelocity * dt;
        }
      }
      sprite.wobble = this.reducedMotion ? 0 : sprite.wobble * Math.exp(-dt / 300);
      sprite.phase += dt * 0.011;
      sprite.shake = Math.max(0, sprite.shake - dt);
      sprite.glow *= Math.exp(-dt / 700);
      const surface = this.shape.surface(total(sprite.layers));
      for (const bubble of sprite.bubbles) bubble.y -= bubble.speed * dt;
      sprite.bubbles = sprite.bubbles.filter((bubble) => bubble.y > surface + bubble.radius);
    });
    for (const particle of this.particles) {
      particle.life += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dt;
      if (particle.kind === "confetti") {
        particle.vy = Math.min(0.24, particle.vy + 0.00018 * dt);
        particle.vx += Math.sin((particle.life + particle.size * 97) * 0.004) * 0.0006 * dt;
      } else if (particle.kind === "drop") {
        particle.vy += 0.0011 * dt;
      } else {
        particle.vx *= 0.96;
        particle.vy *= 0.96;
      }
    }
    this.particles = this.particles.filter((particle) => particle.life < particle.maxLife && particle.y < this.height + 40);
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.sprites.length === 0) return;
    for (const sprite of this.sprites) this.drawShadow(sprite);
    this.sprites.forEach((sprite, index) => {
      if (!sprite.front) this.drawSprite(sprite, index);
    });
    for (const stream of this.streams) this.drawStream(stream);
    this.sprites.forEach((sprite, index) => {
      if (sprite.front) this.drawSprite(sprite, index);
    });
    this.drawParticles();
  }

  private drawShadow(sprite: Sprite): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const away = sprite.pose ? 0.35 : 1 - Math.min(1, Math.max(0, sprite.lift)) * 0.45;
    ctx.save();
    ctx.globalAlpha = sprite.intro * away;
    ctx.fillStyle = this.theme.dark ? "rgb(0 0 0 / 0.34)" : "rgb(30 50 40 / 0.14)";
    ctx.beginPath();
    ctx.ellipse(sprite.restX, sprite.restY + shape.height + 3, shape.width * 0.62, Math.max(2, shape.width * 0.12), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private liquidFill(color: number): CanvasGradient {
    const cached = this.fills.get(color);
    if (cached) return cached;
    const half = this.shape.inner / 2;
    const liquid = LIQUIDS[color];
    const gradient = this.ctx.createLinearGradient(-half, 0, half, 0);
    gradient.addColorStop(0, liquid.light);
    gradient.addColorStop(0.42, liquid.base);
    gradient.addColorStop(1, liquid.deep);
    this.fills.set(color, gradient);
    return gradient;
  }

  private drawSprite(sprite: Sprite, index: number): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const pose = sprite.pose ?? this.restPose(sprite, 1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, sprite.intro));
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    ctx.translate(-shape.anchor(pose.side), 0);
    if (sprite.intro < 1) {
      const scale = 0.8 + 0.2 * sprite.intro;
      ctx.translate(0, shape.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(0, -shape.height / 2);
    }
    if (sprite.glow > 0.02) this.drawGlow(sprite);
    trace(ctx, shape.outline);
    ctx.fillStyle = this.theme.dark ? "rgb(255 255 255 / 0.045)" : "rgb(255 255 255 / 0.55)";
    ctx.fill();
    ctx.save();
    trace(ctx, shape.interior);
    ctx.clip();
    this.drawLiquid(sprite, pose);
    this.drawBubbles(sprite);
    this.drawGloss();
    ctx.restore();
    this.drawGlass(index === this.selected && !sprite.pose);
    if (sprite.sealed > 0.01) this.drawCap(sprite);
    ctx.restore();
  }

  private drawGlow(sprite: Sprite): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const color = LIQUIDS[sprite.layers[sprite.layers.length - 1]?.color ?? 0];
    const gradient = ctx.createRadialGradient(0, shape.height * 0.5, shape.width * 0.2, 0, shape.height * 0.5, shape.height * 0.75);
    gradient.addColorStop(0, withAlpha(color.base, 0.42 * sprite.glow));
    gradient.addColorStop(1, withAlpha(color.base, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(-shape.height, -shape.height * 0.3, shape.height * 2, shape.height * 1.6);
  }

  private wave(sprite: Sprite, x: number): number {
    return sprite.wobble * Math.sin((x / this.shape.inner) * Math.PI * 1.6 + sprite.phase) * 0.9;
  }

  private surfaceRegion(sprite: Sprite, pose: Pose, units: number, world: Point[] | null, wavy: boolean): { region: Point[]; surface: Point[] } {
    const shape = this.shape;
    const steps = 14;
    const surface: Point[] = [];
    if (!world) {
      const y = shape.surface(units);
      const half = shape.inner / 2 + 2;
      for (let i = 0; i <= steps; i++) {
        const x = -half + (2 * half * i) / steps;
        surface.push({ x, y: y + (wavy ? this.wave(sprite, x) : 0) });
      }
      return { region: [...surface, { x: half, y: shape.depth + 4 }, { x: -half, y: shape.depth + 4 }], surface };
    }
    const level = levelForArea(world, shape.area(units));
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of world) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    for (let i = 0; i <= steps; i++) {
      const x = minX - 4 + ((maxX - minX + 8) * i) / steps;
      surface.push(shape.toLocal(pose, { x, y: level + (wavy ? this.wave(sprite, x - pose.x) : 0) }));
    }
    return {
      region: [...surface, shape.toLocal(pose, { x: maxX + 4, y: maxY + 4 }), shape.toLocal(pose, { x: minX - 4, y: maxY + 4 })],
      surface,
    };
  }

  private drawLiquid(sprite: Sprite, pose: Pose): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const layers = sprite.layers;
    let cumulative = total(layers);
    if (cumulative < 1e-3) return;
    const world = Math.abs(pose.angle) < 1e-3 ? null : shape.interior.map((point) => shape.toWorld(pose, point));
    for (let i = layers.length - 1; i >= 0; i--) {
      const top = i === layers.length - 1;
      const { region, surface } = this.surfaceRegion(sprite, pose, cumulative, world, top);
      trace(ctx, region);
      ctx.fillStyle = this.liquidFill(layers[i].color);
      ctx.fill();
      if (top) {
        ctx.beginPath();
        surface.forEach((point, j) => (j === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
        ctx.strokeStyle = "rgb(255 255 255 / 0.38)";
        ctx.lineWidth = Math.max(1, shape.width * 0.04);
        ctx.stroke();
      }
      cumulative -= layers[i].amount;
    }
    if (this.symbols && !world) this.drawSymbols(layers);
  }

  private drawSymbols(layers: readonly Layer[]): void {
    const shape = this.shape;
    const size = Math.min(shape.inner * 0.42, shape.unit * 0.5);
    let start = 0;
    for (const layer of layers) {
      const end = start + layer.amount;
      for (let unit = Math.floor(start); unit < Math.ceil(end); unit++) {
        if (unit + 0.5 < start || unit + 0.5 > end) continue;
        drawSymbol(this.ctx, layer.color, 0, shape.surface(unit + 0.5), size, LIQUIDS[layer.color].ink);
      }
      start = end;
    }
  }

  private drawBubbles(sprite: Sprite): void {
    if (sprite.bubbles.length === 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = "rgb(255 255 255 / 0.55)";
    ctx.lineWidth = 1;
    for (const bubble of sprite.bubbles) {
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private glassFills(): { gloss: CanvasGradient; shade: CanvasGradient } {
    if (this.glossFills) return this.glossFills;
    const half = this.shape.inner / 2;
    const gloss = this.ctx.createLinearGradient(-half, 0, -half + this.shape.inner * 0.45, 0);
    gloss.addColorStop(0, "rgb(255 255 255 / 0.26)");
    gloss.addColorStop(0.55, "rgb(255 255 255 / 0.06)");
    gloss.addColorStop(1, "rgb(255 255 255 / 0)");
    const shade = this.ctx.createLinearGradient(half - this.shape.inner * 0.32, 0, half, 0);
    shade.addColorStop(0, "rgb(0 0 0 / 0)");
    shade.addColorStop(1, this.theme.dark ? "rgb(0 0 0 / 0.22)" : "rgb(0 0 0 / 0.08)");
    this.glossFills = { gloss, shade };
    return this.glossFills;
  }

  private drawGloss(): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const half = shape.inner / 2;
    const { gloss, shade } = this.glassFills();
    ctx.fillStyle = gloss;
    ctx.fillRect(-half, 0, shape.inner * 0.45, shape.depth + 2);
    ctx.fillStyle = shade;
    ctx.fillRect(half - shape.inner * 0.32, 0, shape.inner * 0.32, shape.depth + 2);
  }

  private drawGlass(selected: boolean): void {
    const ctx = this.ctx;
    const shape = this.shape;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgb(255 255 255 / 0.5)";
    ctx.lineWidth = Math.max(1.2, shape.width * 0.05);
    ctx.beginPath();
    ctx.moveTo(-shape.inner * 0.27, shape.depth * 0.1);
    ctx.lineTo(-shape.inner * 0.27, shape.depth * 0.55);
    ctx.stroke();
    ctx.beginPath();
    shape.outline.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.lineJoin = "round";
    ctx.lineWidth = shape.wall;
    if (selected) {
      ctx.shadowColor = this.theme.accent;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = this.theme.accent;
    } else {
      ctx.strokeStyle = this.theme.glass;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const rimWidth = shape.width + shape.lip * 2;
    ctx.beginPath();
    ctx.roundRect(-rimWidth / 2, -shape.rim * 0.55, rimWidth, shape.rim, shape.rim / 2);
    ctx.fillStyle = this.theme.dark ? "rgb(255 255 255 / 0.08)" : "rgb(255 255 255 / 0.7)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, shape.wall * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  private drawCap(sprite: Sprite): void {
    const ctx = this.ctx;
    const shape = this.shape;
    const color = LIQUIDS[sprite.layers[sprite.layers.length - 1]?.color ?? 0];
    const drop = easeOutBounce(Math.min(1, sprite.capDrop));
    const width = shape.width + shape.lip * 2 + 2;
    const height = Math.max(5, shape.width * 0.26);
    const y = -shape.rim * 0.55 - height * 0.82 - (1 - drop) * shape.height * 0.5;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, sprite.sealed);
    const fill = ctx.createLinearGradient(0, y, 0, y + height);
    fill.addColorStop(0, color.light);
    fill.addColorStop(1, color.cap);
    ctx.beginPath();
    ctx.roundRect(-width / 2, y, width, height, height * 0.38);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgb(0 0 0 / 0.28)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-width / 2 + height * 0.5, y + height * 0.3);
    ctx.lineTo(width / 2 - height * 0.5, y + height * 0.3);
    ctx.strokeStyle = "rgb(255 255 255 / 0.45)";
    ctx.lineWidth = Math.max(1, height * 0.16);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  private drawStream(stream: Stream): void {
    const height = stream.bottom - stream.top;
    if (height <= 0.5) return;
    const ctx = this.ctx;
    const liquid = LIQUIDS[stream.color];
    const half = stream.width / 2;
    const gradient = ctx.createLinearGradient(stream.x - half, 0, stream.x + half, 0);
    gradient.addColorStop(0, liquid.light);
    gradient.addColorStop(0.5, liquid.base);
    gradient.addColorStop(1, liquid.deep);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(stream.x - half, stream.top, stream.width, height, half);
    ctx.fill();
    ctx.fillStyle = withAlpha(liquid.light, 0.45);
    ctx.beginPath();
    ctx.ellipse(stream.x, stream.bottom, stream.width * 0.95, stream.width * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const particle of this.particles) {
      const fade = 1 - particle.life / particle.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.kind === "confetti" ? fade * 3 : fade));
      ctx.fillStyle = particle.color;
      ctx.translate(particle.x, particle.y);
      if (particle.kind === "confetti") {
        ctx.rotate(particle.rotation);
        ctx.scale(1, Math.cos(particle.life * 0.012 + particle.size));
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      } else if (particle.kind === "spark") {
        const size = particle.size * (0.6 + 0.6 * Math.sin(Math.PI * (particle.life / particle.maxLife)));
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4;
          const radius = i % 2 === 0 ? size : size * 0.28;
          ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
