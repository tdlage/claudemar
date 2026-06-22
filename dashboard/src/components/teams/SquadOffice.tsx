import { useEffect, useRef } from "react";
import { pixelPalette } from "../../lib/avatar";
import type { TeamWithMembers, AgentAppearance } from "../../lib/types";
import type { ActivityState, Activity } from "../../hooks/useAgentActivity";

export type ZoneClick = "archive" | "cpd" | "library" | "presidencia";
export type HandoffKind = "dispatch" | "subagent";
export interface HandoffAnim { from: string; to: string; ts: number; cancel?: boolean; kind?: HandoffKind }

interface SquadOfficeProps {
  team: TeamWithMembers;
  appearances: Record<string, AgentAppearance>;
  activities: Record<string, ActivityState>;
  activeNames: Set<string>;
  pendingText: (agentName: string) => string | null;
  permissionText: (agentName: string) => string | null;
  screenState: (agentName: string) => { running: boolean; blink: boolean } | null;
  handoffs: HandoffAnim[];
  onAgentClick: (name: string) => void;
  onWaitingClick: (name: string) => void;
  onPermissionClick: (name: string) => void;
  onScreenClick: (name: string) => void;
  onZoneClick: (zone: ZoneClick) => void;
}

const TILE = 16;
const SCALE = 2;
const OW = 40;
const OH = 32;
export const PRESIDENT_NAME = "Presidente";
const SPEED = 1.0;
const PRESIDENT_SPEED = 1.9;

type RoomKey = "cpd" | "cafe" | "archive" | "work" | "library" | "meeting" | "presidencia";
interface Room { x: number; y: number; w: number; h: number; label: string; floor: string; wall: string; clickable?: ZoneClick }

const ROOMS: Record<RoomKey, Room> = {
  cpd: { x: 0, y: 0, w: 13, h: 9, label: "CPD", floor: "#16233a", wall: "#0e1830", clickable: "cpd" },
  cafe: { x: 13, y: 0, w: 13, h: 9, label: "Cafeteria", floor: "#3a2a1e", wall: "#26190f" },
  archive: { x: 26, y: 0, w: 14, h: 9, label: "Arquivo", floor: "#33291b", wall: "#211a0f", clickable: "archive" },
  work: { x: 0, y: 9, w: 40, h: 13, label: "", floor: "#222631", wall: "#161922" },
  library: { x: 0, y: 22, w: 16, h: 5, label: "Biblioteca", floor: "#23311f", wall: "#152012", clickable: "library" },
  meeting: { x: 16, y: 22, w: 24, h: 5, label: "Sala de Reunioes", floor: "#2f2238", wall: "#1d1424" },
  presidencia: { x: 0, y: 27, w: 40, h: 5, label: "Presidencia", floor: "#2c2138", wall: "#1b1424", clickable: "presidencia" },
};

function rectPx(r: Room) { return { rx: r.x * TILE, ry: r.y * TILE, rw: r.w * TILE, rh: r.h * TILE }; }

function pickWander(c: Char, room: Room): void {
  c.wx = (room.x + 1.5 + Math.random() * (room.w - 3)) * TILE;
  c.wy = (room.y + 2 + Math.random() * (room.h - 3)) * TILE;
}

function wanderTarget(c: Char, room: Room, t: number): { x: number; y: number } {
  const reached = Math.hypot(c.wx - c.x, c.wy - c.y) < 6;
  if (reached) {
    if (c.wuntil === 0) c.wuntil = t + 400 + Math.random() * 1400;
    else if (t > c.wuntil) { pickWander(c, room); c.wuntil = 0; }
  }
  return { x: c.wx, y: c.wy };
}

function deskTile(idx: number): { tx: number; ty: number } {
  const perRow = 7;
  const col = idx % perRow;
  const row = Math.floor(idx / perRow);
  return { tx: ROOMS.work.x + 1 + col * 5, ty: ROOMS.work.y + 2 + row * 4 };
}

function roomSlot(r: Room, idx: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.min(Math.max(1, total), Math.floor((r.w - 2) / 3)));
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return {
    x: (r.x + 1.5 + col * ((r.w - 3) / cols)) * TILE,
    y: (r.y + r.h - 2 - row * 1.5) * TILE,
  };
}

interface Char {
  name: string;
  shirt: string | null;
  homeX: number; homeY: number;
  x: number; y: number;
  dir: "down" | "up" | "left" | "right";
  walking: boolean;
  phase: number;
  lastRev: number;
  trip: { zone: "cpd" | "library" | "archive"; until: number; arrived: boolean } | null;
  isPresident: boolean;
  wx: number; wy: number; wuntil: number;
}

type HandoffPhase = "toCafe" | "ack" | "meeting" | "return";
interface HandoffState { to: string; phase: HandoffPhase; since: number; kind: HandoffKind; meetingUntil: number }

const MEETING_MS = 30000;

export function SquadOffice({ team, appearances, activities, activeNames, pendingText, permissionText, screenState, handoffs, onAgentClick, onWaitingClick, onPermissionClick, onScreenClick, onZoneClick }: SquadOfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ s: SCALE, ox: 0, oy: 0 });

  const activitiesRef = useRef(activities);
  const pendingRef = useRef(pendingText);
  const permissionRef = useRef(permissionText);
  const screenRef = useRef(screenState);
  const activeRef = useRef(activeNames);
  activitiesRef.current = activities;
  pendingRef.current = pendingText;
  permissionRef.current = permissionText;
  screenRef.current = screenState;
  activeRef.current = activeNames;

  const charsRef = useRef<Char[]>([]);
  const handoffsRef = useRef<Map<string, HandoffState>>(new Map());
  const lastHandoffTs = useRef(0);

  useEffect(() => {
    const map = handoffsRef.current;
    for (const h of handoffs) {
      if (h.ts <= lastHandoffTs.current) continue;
      lastHandoffTs.current = h.ts;
      const active = map.get(h.from);
      if (h.cancel) {
        if (active && active.phase !== "return") active.phase = "return";
        continue;
      }
      if (active && active.phase !== "return") {
        if (h.to) active.to = h.to;
      } else {
        map.set(h.from, { to: h.to, phase: "toCafe", since: 0, kind: h.kind ?? "dispatch", meetingUntil: 0 });
      }
    }
  }, [handoffs]);

  useEffect(() => {
    const members = team.members.map((m) => m.agentName);
    const prev = new Map(charsRef.current.map((c) => [c.name, c]));
    const makeChar = (name: string, hx: number, hy: number, idx: number, isPresident: boolean): Char => {
      const p = prev.get(name);
      return {
        name, shirt: appearances[name]?.color ?? null,
        homeX: hx, homeY: hy,
        x: p?.x ?? hx, y: p?.y ?? hy,
        dir: p?.dir ?? "down", walking: false,
        phase: p?.phase ?? (idx * 37) % 100,
        lastRev: p?.lastRev ?? 0, trip: p?.trip ?? null,
        isPresident,
        wx: p?.wx ?? hx, wy: p?.wy ?? hy, wuntil: p?.wuntil ?? 0,
      };
    };
    const memberChars = members.map((name, idx) => {
      const d = deskTile(idx);
      return makeChar(name, (d.tx + 1.5) * TILE, (d.ty + 2.5) * TILE, idx, false);
    });
    const pr = ROOMS.presidencia;
    const president = makeChar(PRESIDENT_NAME, (pr.x + pr.w / 2) * TILE, (pr.y + pr.h - 1.5) * TILE, members.length, true);
    charsRef.current = [...memberChars, president];

    const stat = document.createElement("canvas");
    stat.width = OW * TILE * SCALE; stat.height = OH * TILE * SCALE;
    const sctx = stat.getContext("2d");
    if (sctx) { sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); sctx.imageSmoothingEnabled = false; drawStatic(sctx, members.length); }
    staticRef.current = stat;
  }, [team, appearances]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      if (cw === 0 || ch === 0) return;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const officeW = OW * TILE, officeH = OH * TILE;
      const s = Math.min(canvas.width / officeW, canvas.height / officeH);
      viewRef.current = { s, ox: (canvas.width - officeW * s) / 2, oy: (canvas.height - officeH * s) / 2 };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);
    return () => { ro.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const rawAct = (name: string): Activity => {
      const st = activitiesRef.current[name];
      if (st) return st.activity;
      if (pendingRef.current(name)) return "waiting";
      if (activeRef.current.has(name)) return "working";
      return "idle";
    };
    const effAct = (c: Char): Activity => {
      const a = rawAct(c.name);
      return (a === "mcp" || a === "skill" || a === "file") && !c.trip ? "working" : a;
    };
    const meetingSlot = (name: string, mates: string[]) =>
      roomSlot(ROOMS.meeting, Math.max(0, mates.indexOf(name)), Math.max(1, mates.length));
    const targetFor = (c: Char, t: number, mates: string[]): { x: number; y: number } => {
      const h = handoffsRef.current.get(c.name);
      if (h && h.phase !== "return") {
        const cafe = roomSlot(ROOMS.cafe, 0, 1);
        if (h.phase === "toCafe") {
          if (h.to && Math.hypot(cafe.x - c.x, cafe.y - c.y) < 6) { h.phase = "ack"; h.since = t; }
          return cafe;
        }
        if (h.phase === "ack") {
          if (t - h.since <= 2200) return cafe;
          if (h.kind === "subagent") { h.phase = "meeting"; h.meetingUntil = t + MEETING_MS; }
          else h.phase = "return";
        }
        if (h.phase === "meeting") {
          if (t <= h.meetingUntil) return meetingSlot(c.name, mates);
          h.phase = "return";
        }
      }
      if (h && h.phase === "return") {
        if (c.isPresident) {
          if (Math.hypot(c.homeX - c.x, c.homeY - c.y) < 6) handoffsRef.current.delete(c.name);
          return { x: c.homeX, y: c.homeY };
        }
        handoffsRef.current.delete(c.name);
      }
      if (mates.includes(c.name)) return meetingSlot(c.name, mates);
      if (c.isPresident) return wanderTarget(c, ROOMS.presidencia, t);
      const st = activitiesRef.current[c.name];
      if (st && st.rev !== c.lastRev) {
        c.lastRev = st.rev;
        if (st.activity === "mcp") c.trip = { zone: "cpd", until: 0, arrived: false };
        else if (st.activity === "skill") c.trip = { zone: "library", until: 0, arrived: false };
        else if (st.activity === "file") c.trip = { zone: "archive", until: 0, arrived: false };
      }
      if (c.trip) {
        const slot = roomSlot(ROOMS[c.trip.zone], 0, 1);
        if (!c.trip.arrived) {
          if (Math.hypot(slot.x - c.x, slot.y - c.y) < 4) { c.trip.arrived = true; c.trip.until = t + 2600; }
          return slot;
        }
        if (t < c.trip.until) return slot;
        c.trip = null;
      }
      const act = effAct(c);
      if (act === "idle") return wanderTarget(c, ROOMS.cafe, t);
      return { x: c.homeX, y: c.homeY };
    };

    const render = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#0b0b10";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const { s, ox, oy } = viewRef.current;
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0, staticRef.current.width, staticRef.current.height, ox, oy, OW * TILE * s, OH * TILE * s);
      ctx.setTransform(s, 0, 0, s, ox, oy);

      const chars = charsRef.current;
      const mates: string[] = [];
      for (const [from, h] of handoffsRef.current) {
        if (h.phase === "meeting") { mates.push(from, h.to); }
      }

      chars.filter((c) => !c.isPresident).forEach((c, idx) => drawScreen(ctx, idx, screenRef.current(c.name), t));

      for (const c of chars) {
        const tgt = targetFor(c, t, mates);
        const dx = tgt.x - c.x, dy = tgt.y - c.y;
        const dist = Math.hypot(dx, dy);
        const speed = c.isPresident && handoffsRef.current.has(c.name) ? PRESIDENT_SPEED : SPEED;
        if (dist > 1.5) {
          const step = Math.min(speed, dist);
          c.x += (dx / dist) * step; c.y += (dy / dist) * step; c.walking = true;
          c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        } else c.walking = false;
      }
      [...chars].sort((a, b) => a.y - b.y).forEach((c) => drawChar(ctx, c, t));

      for (const c of chars) {
        if (c.isPresident) continue;
        const perm = permissionRef.current(c.name);
        if (perm) { drawBubble(ctx, c, perm, t, "#ef4444"); continue; }
        const txt = pendingRef.current(c.name);
        if (txt || rawAct(c.name) === "waiting") drawBubble(ctx, c, txt ?? "Preciso confirmar algo", t);
      }
      for (const [from, h] of handoffsRef.current) {
        if (h.phase === "toCafe" || h.phase === "ack") {
          const fromChar = chars.find((c) => c.name === from);
          if (fromChar) drawMiniBubble(ctx, fromChar, "!", t, "#facc15");
        }
        if (h.phase === "ack") {
          const toChar = chars.find((c) => c.name === h.to);
          if (toChar) drawMiniBubble(ctx, toChar, "\u{1F44D}", t, "#22c55e");
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toLogical = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { s, ox, oy } = viewRef.current;
      const bx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const by = (e.clientY - rect.top) * (canvas.height / rect.height);
      return { x: (bx - ox) / s, y: (by - oy) / s };
    };
    const charAt = (lx: number, ly: number) => charsRef.current.find((c) => !c.isPresident && Math.abs(lx - c.x) <= 9 && ly >= c.y - 22 && ly <= c.y + 4);
    const screenAt = (lx: number, ly: number): string | null => {
      const members = charsRef.current.filter((c) => !c.isPresident);
      for (let idx = 0; idx < members.length; idx++) {
        const { bx, by, bw, bh } = deskScreenRect(idx);
        if (lx >= bx && lx <= bx + bw && ly >= by && ly <= by + bh && screenRef.current(members[idx].name)) return members[idx].name;
      }
      return null;
    };
    const zoneAt = (lx: number, ly: number): ZoneClick | null => {
      for (const key of Object.keys(ROOMS) as RoomKey[]) {
        const r = ROOMS[key];
        if (!r.clickable) continue;
        const { rx, ry, rw, rh } = rectPx(r);
        if (lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh) return r.clickable;
      }
      return null;
    };
    const onClick = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const c = charAt(x, y);
      if (c) {
        if (permissionRef.current(c.name)) onPermissionClick(c.name);
        else if (pendingRef.current(c.name) || activitiesRef.current[c.name]?.activity === "waiting") onWaitingClick(c.name);
        else onAgentClick(c.name);
        return;
      }
      const screen = screenAt(x, y);
      if (screen) { onScreenClick(screen); return; }
      const zone = zoneAt(x, y);
      if (zone) onZoneClick(zone);
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const c = charAt(x, y);
      const screen = c ? null : screenAt(x, y);
      const zone = c || screen ? null : zoneAt(x, y);
      canvas.style.cursor = c || screen || zone ? "pointer" : "default";
      const tip = tipRef.current;
      if (tip) {
        const screenLabel = screen ? (screenRef.current(screen)?.running ? `${screen} — ver execução em andamento` : `${screen} — ver relatório`) : "";
        const label = c ? c.name : screenLabel || (zone === "cpd" ? "CPD — gerenciar MCPs" : zone === "library" ? "Biblioteca — gerenciar skills" : zone === "archive" ? "Arquivo — enviar/baixar arquivos" : zone === "presidencia" ? "Presidência — enviar mensagem ao presidente" : "");
        if (label) { tip.textContent = label; tip.style.display = "block"; tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 12}px`; }
        else tip.style.display = "none";
      }
    };
    canvas.addEventListener("click", onClick as (e: Event) => void);
    canvas.addEventListener("pointermove", onMove);
    return () => { canvas.removeEventListener("click", onClick as (e: Event) => void); canvas.removeEventListener("pointermove", onMove); };
  }, [onAgentClick, onWaitingClick, onPermissionClick, onScreenClick, onZoneClick]);

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden rounded-lg border border-border bg-[#0b0b10]">
      <canvas ref={canvasRef} className="pixel-art block w-full h-full" style={{ imageRendering: "pixelated" }} />
      <div ref={tipRef} className="fixed z-50 hidden pointer-events-none rounded bg-black/85 px-1.5 py-0.5 text-[11px] text-white" />
    </div>
  );
}

function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function drawStatic(ctx: CanvasRenderingContext2D, memberCount: number) {
  fill(ctx, 0, 0, OW * TILE, OH * TILE, "#0b0b10");
  for (const key of Object.keys(ROOMS) as RoomKey[]) {
    const r = ROOMS[key];
    const { rx, ry, rw, rh } = rectPx(r);
    for (let ty = 0; ty < r.h; ty++) for (let tx = 0; tx < r.w; tx++) {
      const ch = (tx + ty) % 2 === 0;
      ctx.fillStyle = ch ? r.floor : shade(r.floor, -8);
      ctx.fillRect(rx + tx * TILE, ry + ty * TILE, TILE, TILE);
    }
    fill(ctx, rx, ry, rw, 5, shade(r.wall, 18));
    fill(ctx, rx, ry, 3, rh, r.wall);
    fill(ctx, rx + rw - 3, ry, 3, rh, r.wall);
    fill(ctx, rx, ry + rh - 3, rw, 3, r.wall);
    if (r.label) { ctx.fillStyle = "#e8e8ef"; ctx.font = "7px monospace"; ctx.textBaseline = "top"; ctx.fillText(r.label, rx + 5, ry + 1); }
  }
  drawCpd(ctx);
  drawCafe(ctx);
  drawArchive(ctx);
  drawLibrary(ctx);
  drawMeeting(ctx);
  drawPresidencia(ctx);
  for (let i = 0; i < memberCount; i++) drawDesk(ctx, deskTile(i));
}

function drawPresidencia(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.presidencia; const { rx, ry, rw, rh } = rectPx(r);
  const dx = rx + rw / 2 - 22, dy = ry + rh - 26;
  fill(ctx, dx, dy, 44, 12, "#3a2c20");
  fill(ctx, dx + 2, dy + 2, 40, 8, "#5a4330");
  fill(ctx, dx + 4, dy + 4, 10, 4, "#caa46a");
  fill(ctx, rx + 8, ry + 6, 6, 10, "#b8902f");
  fill(ctx, rx + 9, ry + 7, 4, 4, "#e2c15a");
  fill(ctx, rx + rw - 14, ry + 6, 6, 10, "#b8902f");
  fill(ctx, rx + rw - 13, ry + 7, 4, 4, "#e2c15a");
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function drawDesk(ctx: CanvasRenderingContext2D, d: { tx: number; ty: number }) {
  const x = d.tx * TILE, y = d.ty * TILE;
  fill(ctx, x + 2, y + 10, 28, 4, "#8b5e34");
  fill(ctx, x + 2, y + 14, 28, 3, "#6e4a28");
  fill(ctx, x + 7, y + 11, 9, 2, "#cfd3da");
}

function deskScreenRect(idx: number): { bx: number; by: number; bw: number; bh: number } {
  const d = deskTile(idx);
  const x = d.tx * TILE, y = d.ty * TILE;
  return { bx: x + 5, by: y - 14, bw: 22, bh: 24 };
}

function drawScreen(ctx: CanvasRenderingContext2D, idx: number, st: { running: boolean; blink: boolean } | null, t: number) {
  const { bx, by, bw, bh } = deskScreenRect(idx);
  const cx = bx + bw / 2;
  fill(ctx, cx - 1, by + bh, 2, 4, "#15181f");
  fill(ctx, cx - 4, by + bh + 4, 8, 1, "#15181f");
  fill(ctx, bx, by, bw, bh, "#15181f");
  fill(ctx, bx + 1, by + 1, bw - 2, bh - 2, "#0b0e14");
  const sx = bx + 2, sy = by + 2, sw = bw - 4, sh = bh - 4;
  if (st?.blink) {
    const flash = Math.floor(t / 350) % 2 === 0;
    fill(ctx, sx, sy, sw, sh, flash ? "#14361f" : "#0b1410");
    const ck = flash ? "#34d399" : "#1f7a52";
    const mx = sx + sw / 2 - 3, my = sy + sh / 2;
    fill(ctx, mx, my, 2, 2, ck);
    fill(ctx, mx + 2, my + 2, 2, 2, ck);
    fill(ctx, mx + 4, my - 2, 2, 2, ck);
    fill(ctx, mx + 6, my - 4, 2, 2, ck);
  } else if (st?.running) {
    fill(ctx, sx, sy, sw, sh, "#0e1626");
    for (let i = 0; i < 5; i++) {
      const ly = sy + 2 + i * 3;
      const lw = ((Math.floor(t / 220) + i) % 2 ? sw - 6 : sw - 11);
      fill(ctx, sx + 2, ly, Math.max(4, lw), 1, i % 2 ? "#3f5d8a" : "#2b3a55");
    }
    if (Math.floor(t / 400) % 2) fill(ctx, sx + 2, sy + 2 + 5 * 3, 3, 1, "#36d399");
  } else {
    fill(ctx, sx, sy, sw, sh, "#0c1018");
    fill(ctx, sx + 2, sy + sh - 3, sw - 4, 1, "#141a24");
  }
}

function drawCpd(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.cpd; const { rx, ry, rh } = rectPx(r);
  for (let i = 0; i < 4; i++) {
    const x = rx + 8 + i * 18, y = ry + rh - 40;
    fill(ctx, x, y, 14, 34, "#11151c");
    fill(ctx, x + 1, y + 1, 12, 32, "#1b2330");
    for (let k = 0; k < 6; k++) { fill(ctx, x + 2, y + 3 + k * 5, 10, 3, "#0c1118"); fill(ctx, x + 3, y + 4 + k * 5, 1, 1, k % 2 ? "#36d399" : "#fbbf24"); fill(ctx, x + 6, y + 4 + k * 5, 1, 1, "#60a5fa"); }
  }
}

function drawCafe(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.cafe; const { rx, ry, rw, rh } = rectPx(r);
  fill(ctx, rx + 6, ry + 8, 14, 12, "#3a2817");
  fill(ctx, rx + 8, ry + 5, 4, 4, "#6b4a2b");
  fill(ctx, rx + 15, ry + 11, 4, 3, "#d7dde6");
  fill(ctx, rx + 9, ry + 10, 2, 2, "#caa46a");
  const cx = rx + rw - 22, cy = ry + rh - 16;
  fill(ctx, cx, cy, 16, 12, "#5a3a2a");
  fill(ctx, cx + 4, cy - 4, 8, 4, "#6e4a34");
  fill(ctx, cx + 5, cy + 3, 6, 4, "#2a2f3a");
}

function drawArchive(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.archive; const { rx, ry, rh } = rectPx(r);
  for (let i = 0; i < 4; i++) {
    const x = rx + 8 + i * 22, y = ry + rh - 34;
    fill(ctx, x, y, 16, 30, "#6e5a34");
    fill(ctx, x + 1, y + 1, 14, 28, "#8a7142");
    for (let k = 0; k < 4; k++) { fill(ctx, x + 2, y + 2 + k * 7, 12, 5, "#5a4a2c"); fill(ctx, x + 6, y + 4 + k * 7, 4, 1, "#caa46a"); }
  }
}

function drawLibrary(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.library; const { rx, ry, rw } = rectPx(r);
  const books = ["#c0392b", "#27ae60", "#2980b9", "#f39c12", "#8e44ad"];
  for (let row = 0; row < 2; row++) {
    const y = ry + 8 + row * 22;
    fill(ctx, rx + 6, y, rw - 12, 18, "#4a3320");
    for (let i = 0; i < (rw - 16) / 3; i++) fill(ctx, rx + 8 + i * 3, y + 2, 2, 14, books[(i + row) % books.length]);
  }
}

function drawMeeting(ctx: CanvasRenderingContext2D) {
  const r = ROOMS.meeting; const { rx, ry, rw, rh } = rectPx(r);
  const tx = rx + 16, ty = ry + 18, tw = rw - 32, th = rh - 30;
  fill(ctx, tx, ty, tw, th, "#5a4633");
  fill(ctx, tx + 2, ty + 2, tw - 4, th - 4, "#6e573f");
  for (let i = 0; i < tw / 18; i++) { fill(ctx, tx + 8 + i * 18, ty - 5, 8, 4, "#3a2f3a"); fill(ctx, tx + 8 + i * 18, ty + th + 1, 8, 4, "#3a2f3a"); }
}

function drawChar(ctx: CanvasRenderingContext2D, c: Char, t: number) {
  const p = pixelPalette(c.name, c.shirt);
  const pants = "#39414f";
  const shoe = "#15171d";
  const x = Math.round(c.x);
  const step = c.walking ? (Math.floor(t / 130 + c.phase) % 2 ? 1 : -1) : 0;
  const bob = c.walking ? 0 : Math.round(Math.sin(t / 600 + c.phase));
  const y = Math.round(c.y) + bob;

  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.beginPath(); ctx.ellipse(x, y + 1, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  // legs
  fill(ctx, x - 4, y - 6 + step, 3, 6, pants);
  fill(ctx, x + 1, y - 6 - step, 3, 6, pants);
  fill(ctx, x - 4, y, 3, 1, shoe);
  fill(ctx, x + 1, y, 3, 1, shoe);
  // torso
  fill(ctx, x - 5, y - 14, 10, 9, p.shirt);
  fill(ctx, x - 5, y - 14, 3, 9, shade(p.shirt, 14));
  fill(ctx, x + 3, y - 14, 2, 9, shade(p.shirt, -16));
  // arms
  const armStep = c.walking ? step : 0;
  const armY = y - 13 + armStep;
  fill(ctx, x - 7, armY, 2, 7, p.shirt);
  fill(ctx, x + 5, y - 13 - armStep, 2, 7, p.shirt);
  fill(ctx, x - 7, armY + 7, 2, 1, p.skin);
  fill(ctx, x + 5, y - 6 - armStep, 2, 1, p.skin);
  // head
  fill(ctx, x - 5, y - 23, 10, 9, p.skin);
  fill(ctx, x - 5, y - 24, 10, 4, p.hair);
  fill(ctx, x - 6, y - 23, 1, 5, p.hair);
  fill(ctx, x + 5, y - 23, 1, 5, p.hair);
  // face by direction
  if (c.dir === "down") { fill(ctx, x - 3, y - 19, 2, 2, "#1b1f29"); fill(ctx, x + 1, y - 19, 2, 2, "#1b1f29"); }
  else if (c.dir === "left") { fill(ctx, x - 4, y - 19, 2, 2, "#1b1f29"); fill(ctx, x - 5, y - 23, 2, 9, p.hair); }
  else if (c.dir === "right") { fill(ctx, x + 2, y - 19, 2, 2, "#1b1f29"); fill(ctx, x + 3, y - 23, 2, 9, p.hair); }
  else { fill(ctx, x - 5, y - 23, 10, 7, p.hair); }

  if (c.isPresident) {
    fill(ctx, x - 4, y - 27, 8, 2, "#f5c518");
    fill(ctx, x - 4, y - 29, 2, 2, "#f5c518");
    fill(ctx, x - 1, y - 30, 2, 3, "#f5c518");
    fill(ctx, x + 2, y - 29, 2, 2, "#f5c518");
  }
  drawName(ctx, c.isPresident ? PRESIDENT_NAME : c.name, x, y - (c.isPresident ? 32 : 27));
}

function drawName(ctx: CanvasRenderingContext2D, name: string, cx: number, topY: number) {
  const label = name.length > 12 ? name.slice(0, 11) + "…" : name;
  ctx.font = "6px monospace";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillText(label, cx + 0.5, topY + 0.5);
  ctx.fillText(label, cx - 0.5, topY - 0.5);
  ctx.fillStyle = "#e8e8ef";
  ctx.fillText(label, cx, topY);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawMiniBubble(ctx: CanvasRenderingContext2D, c: Char, glyph: string, t: number, color: string) {
  const cx = Math.round(c.x);
  const y = Math.round(c.y) - 46 + Math.round(Math.sin(t / 250));
  const w = 14, h = 14;
  fill(ctx, cx - w / 2, y, w, h, "#ffffff");
  fill(ctx, cx - w / 2 - 1, y + 2, 1, h - 4, "#ffffff");
  fill(ctx, cx + w / 2, y + 2, 1, h - 4, "#ffffff");
  fill(ctx, cx - 2, y + h, 4, 2, "#ffffff");
  ctx.fillStyle = color;
  ctx.font = "10px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(glyph, cx, y + h / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawBubble(ctx: CanvasRenderingContext2D, c: Char, text: string, t: number, accent = "#facc15") {
  const short = text.length > 22 ? text.slice(0, 22) + "…" : text;
  const w = Math.max(28, short.length * 4 + 8);
  const x = Math.round(c.x) - w / 2;
  const y = Math.round(c.y) - 40 + Math.round(Math.sin(t / 250));
  fill(ctx, x, y, w, 12, "#ffffff");
  fill(ctx, x - 1, y + 1, 1, 9, "#ffffff");
  fill(ctx, x + w, y + 1, 1, 9, "#ffffff");
  fill(ctx, Math.round(c.x) - 2, y + 12, 4, 2, "#ffffff");
  ctx.fillStyle = accent; ctx.fillRect(x + 2, y + 2, 2, 8);
  ctx.fillStyle = "#111"; ctx.font = "7px monospace"; ctx.textBaseline = "top";
  ctx.fillText(short, x + 6, y + 2);
}
