import { useEffect, useRef } from "react";
import { pixelPalette } from "../../lib/avatar";
import type { TeamWithMembers, AgentAppearance } from "../../lib/types";
import type { ActivityState, Activity } from "../../hooks/useAgentActivity";

export type ZoneClick = "archive" | "cpd" | "library";

interface SquadOfficeProps {
  team: TeamWithMembers;
  appearances: Record<string, AgentAppearance>;
  activities: Record<string, ActivityState>;
  activeNames: Set<string>;
  pendingText: (agentName: string) => string | null;
  admin: boolean;
  onAgentClick: (name: string) => void;
  onWaitingClick: (name: string) => void;
  onZoneClick: (zone: ZoneClick) => void;
}

const TILE = 16;
const SCALE = 2;
const OW = 40;
const OH = 26;

type RoomKey = "cpd" | "cafe" | "archive" | "work" | "library" | "meeting";
interface Room { x: number; y: number; w: number; h: number; label: string; floor: string; wall: string; clickable?: ZoneClick }

const ROOMS: Record<RoomKey, Room> = {
  cpd: { x: 1, y: 1, w: 12, h: 8, label: "CPD", floor: "#16233a", wall: "#0e1830", clickable: "cpd" },
  cafe: { x: 14, y: 1, w: 11, h: 8, label: "Cafeteria", floor: "#3a2a1e", wall: "#26190f" },
  archive: { x: 26, y: 1, w: 13, h: 8, label: "Arquivo", floor: "#33291b", wall: "#211a0f", clickable: "archive" },
  work: { x: 1, y: 10, w: 38, h: 9, label: "", floor: "#222631", wall: "#161922" },
  library: { x: 1, y: 20, w: 14, h: 5, label: "Biblioteca", floor: "#23311f", wall: "#152012", clickable: "library" },
  meeting: { x: 16, y: 20, w: 23, h: 5, label: "Sala de Reunioes", floor: "#2f2238", wall: "#1d1424" },
};

function rectPx(r: Room) { return { rx: r.x * TILE, ry: r.y * TILE, rw: r.w * TILE, rh: r.h * TILE }; }

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
    x: (r.x + 1.5 + col * ((r.w - 3) / Math.max(1, cols))) * TILE,
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
  trip: { zone: "cpd" | "library"; until: number; arrived: boolean } | null;
}

export function SquadOffice({ team, appearances, activities, activeNames, pendingText, admin, onAgentClick, onWaitingClick, onZoneClick }: SquadOfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);

  const activitiesRef = useRef(activities);
  const pendingRef = useRef(pendingText);
  const activeRef = useRef(activeNames);
  activitiesRef.current = activities;
  pendingRef.current = pendingText;
  activeRef.current = activeNames;

  const charsRef = useRef<Char[]>([]);
  const membersRef = useRef<string[]>([]);

  useEffect(() => {
    const members = team.members.map((m) => m.agentName);
    membersRef.current = members;
    const prev = new Map(charsRef.current.map((c) => [c.name, c]));
    charsRef.current = members.map((name, idx) => {
      const d = deskTile(idx);
      const hx = (d.tx + 1.5) * TILE;
      const hy = (d.ty + 2.5) * TILE;
      const p = prev.get(name);
      return {
        name, shirt: appearances[name]?.color ?? null,
        homeX: hx, homeY: hy,
        x: p?.x ?? hx, y: p?.y ?? hy,
        dir: p?.dir ?? "down", walking: false,
        phase: p?.phase ?? (idx * 37) % 100,
        lastRev: p?.lastRev ?? 0, trip: p?.trip ?? null,
      };
    });

    const w = OW * TILE * SCALE, h = OH * TILE * SCALE;
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = w; canvas.height = h; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
    const stat = document.createElement("canvas");
    stat.width = w; stat.height = h;
    const sctx = stat.getContext("2d");
    if (sctx) { sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); sctx.imageSmoothingEnabled = false; drawStatic(sctx, members.length); }
    staticRef.current = stat;
  }, [team, appearances]);

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
      return (a === "mcp" || a === "skill") && !c.trip ? "working" : a;
    };
    const targetFor = (c: Char, t: number, workingNames: string[], idleNames: string[]): { x: number; y: number } => {
      const st = activitiesRef.current[c.name];
      if (st && st.rev !== c.lastRev) {
        c.lastRev = st.rev;
        if (st.activity === "mcp") c.trip = { zone: "cpd", until: 0, arrived: false };
        else if (st.activity === "skill") c.trip = { zone: "library", until: 0, arrived: false };
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
      if (act === "idle") return roomSlot(ROOMS.cafe, Math.max(0, idleNames.indexOf(c.name)), Math.max(1, idleNames.length));
      if (act === "working" && workingNames.length >= 2) return roomSlot(ROOMS.meeting, Math.max(0, workingNames.indexOf(c.name)), workingNames.length);
      return { x: c.homeX, y: c.homeY };
    };

    const render = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const chars = charsRef.current;
      const workingNames = chars.filter((c) => effAct(c) === "working").map((c) => c.name);
      const idleNames = chars.filter((c) => effAct(c) === "idle").map((c) => c.name);

      for (const c of chars) {
        const tgt = targetFor(c, t, workingNames, idleNames);
        const dx = tgt.x - c.x, dy = tgt.y - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1.5) {
          c.x += (dx / dist) * 0.55; c.y += (dy / dist) * 0.55; c.walking = true;
          c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        } else c.walking = false;
      }
      [...chars].sort((a, b) => a.y - b.y).forEach((c) => drawChar(ctx, c, t));

      for (const c of chars) {
        const txt = pendingRef.current(c.name);
        if (txt || rawAct(c.name) === "waiting") drawBubble(ctx, c, txt ?? "Preciso confirmar algo", t);
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
      return { x: (e.clientX - rect.left) / SCALE, y: (e.clientY - rect.top) / SCALE };
    };
    const charAt = (lx: number, ly: number) => charsRef.current.find((c) => Math.abs(lx - c.x) <= 9 && ly >= c.y - 22 && ly <= c.y + 4);
    const zoneAt = (lx: number, ly: number): ZoneClick | null => {
      for (const key of Object.keys(ROOMS) as RoomKey[]) {
        const r = ROOMS[key];
        if (r.clickable && lx >= r.x * TILE && lx <= (r.x + r.w) * TILE && ly >= r.y * TILE && ly <= (r.y + r.h) * TILE) return r.clickable;
      }
      return null;
    };
    const onClick = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const c = charAt(x, y);
      if (c) {
        if (pendingRef.current(c.name) || activitiesRef.current[c.name]?.activity === "waiting") onWaitingClick(c.name);
        else onAgentClick(c.name);
        return;
      }
      const zone = zoneAt(x, y);
      if (zone) onZoneClick(zone);
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const c = charAt(x, y);
      const zone = zoneAt(x, y);
      canvas.style.cursor = c || zone ? "pointer" : "default";
      const tip = tipRef.current;
      if (tip) {
        const label = c ? c.name : zone === "cpd" ? "CPD — gerenciar MCPs" : zone === "library" ? "Biblioteca — gerenciar skills" : zone === "archive" ? "Arquivo — enviar/baixar arquivos" : "";
        if (label) { tip.textContent = label; tip.style.display = "block"; tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 12}px`; }
        else tip.style.display = "none";
      }
    };
    canvas.addEventListener("click", onClick as (e: Event) => void);
    canvas.addEventListener("pointermove", onMove);
    return () => { canvas.removeEventListener("click", onClick as (e: Event) => void); canvas.removeEventListener("pointermove", onMove); };
  }, [onAgentClick, onWaitingClick, onZoneClick, admin]);

  return (
    <div className="relative w-full h-full overflow-auto rounded-lg border border-border bg-[#0b0b10]">
      <canvas ref={canvasRef} className="pixel-art block m-auto" style={{ imageRendering: "pixelated" }} />
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
    if (r.label) { ctx.fillStyle = "#e8e8ef"; ctx.font = "7px monospace"; ctx.textBaseline = "top"; ctx.fillText(r.label, rx + 5, ry - 0.5); }
  }
  drawCpd(ctx);
  drawCafe(ctx);
  drawArchive(ctx);
  drawLibrary(ctx);
  drawMeeting(ctx);
  for (let i = 0; i < memberCount; i++) drawDesk(ctx, deskTile(i));
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
  fill(ctx, x + 10, y, 14, 9, "#2a2f3a");
  fill(ctx, x + 11, y + 1, 12, 6, "#0e1626");
  fill(ctx, x + 13, y + 2, 6, 1, "#3f5d8a");
  fill(ctx, x + 13, y + 4, 4, 1, "#2b3a55");
  fill(ctx, x + 16, y + 9, 2, 1, "#2a2f3a");
  fill(ctx, x + 2, y + 10, 28, 4, "#8b5e34");
  fill(ctx, x + 2, y + 14, 28, 3, "#6e4a28");
  fill(ctx, x + 7, y + 11, 9, 2, "#cfd3da");
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
  const armY = y - 13 + (c.walking ? step : 0);
  fill(ctx, x - 7, armY, 2, 7, p.shirt);
  fill(ctx, x + 5, y - 13 - (c.walking ? step : 0), 2, 7, p.shirt);
  fill(ctx, x - 7, armY + 7, 2, 1, p.skin);
  fill(ctx, x + 5, y - 6 - (c.walking ? step : 0), 2, 1, p.skin);
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
}

function drawBubble(ctx: CanvasRenderingContext2D, c: Char, text: string, t: number) {
  const short = text.length > 22 ? text.slice(0, 22) + "…" : text;
  const w = Math.max(28, short.length * 4 + 8);
  const x = Math.round(c.x) - w / 2;
  const y = Math.round(c.y) - 40 + Math.round(Math.sin(t / 250));
  fill(ctx, x, y, w, 12, "#ffffff");
  fill(ctx, x - 1, y + 1, 1, 9, "#ffffff");
  fill(ctx, x + w, y + 1, 1, 9, "#ffffff");
  fill(ctx, Math.round(c.x) - 2, y + 12, 4, 2, "#ffffff");
  ctx.fillStyle = "#facc15"; ctx.fillRect(x + 2, y + 2, 2, 8);
  ctx.fillStyle = "#111"; ctx.font = "7px monospace"; ctx.textBaseline = "top";
  ctx.fillText(short, x + 6, y + 2);
}
