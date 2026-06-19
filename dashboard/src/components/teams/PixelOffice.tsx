import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { agentColor, pixelPalette } from "../../lib/avatar";
import type { TeamsOverview } from "../../lib/types";
import type { AgentLiveStatus } from "../../hooks/useTeams";

interface PixelOfficeProps {
  overview: TeamsOverview;
  statusOf: (name: string) => AgentLiveStatus;
  admin: boolean;
  onMove: (agentName: string, teamId: string | null) => void;
}

const TILE = 16;
const SCALE = 3;
const GAP = 1;
const ROOMS_PER_ROW = 2;
const DESK_W = 4;
const DESK_H = 3;
const AISLE = 1;
const ROOM_W = 1 + DESK_W + AISLE + DESK_W + 1;

interface RoomLayout {
  teamId: string | null;
  title: string;
  emoji: string;
  color: string;
  accent: boolean;
  tx: number; ty: number; tw: number; th: number;
  members: string[];
}

interface CharState {
  name: string;
  shirt: string | null;
  room: RoomLayout;
  homeX: number; homeY: number;
  x: number; y: number;
  tx: number; ty: number;
  phase: number;
  wanderAt: number;
  walking: boolean;
}

function deskTile(room: RoomLayout, idx: number): { tx: number; ty: number } {
  const col = idx % 2;
  const drow = Math.floor(idx / 2);
  return {
    tx: (room.tx + 1) + col * (DESK_W + AISLE),
    ty: (room.ty + 2) + drow * DESK_H,
  };
}

export function PixelOffice({ overview, statusOf, admin, onMove }: PixelOfficeProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);

  const overviewRef = useRef(overview);
  const statusRef = useRef(statusOf);
  const adminRef = useRef(admin);
  const onMoveRef = useRef(onMove);
  overviewRef.current = overview;
  statusRef.current = statusOf;
  adminRef.current = admin;
  onMoveRef.current = onMove;

  const charsRef = useRef<Map<string, CharState>>(new Map());
  const charListRef = useRef<CharState[]>([]);
  const roomsRef = useRef<RoomLayout[]>([]);
  const dragRef = useRef<{ name: string; mx: number; my: number; moved: boolean } | null>(null);

  useEffect(() => {
    const rooms: RoomLayout[] = overview.teams.map((t) => ({
      teamId: t.id, title: t.name, emoji: t.emoji ?? "🏢", color: t.color ?? agentColor(t.name),
      accent: true, tx: 0, ty: 0, tw: 0, th: 0, members: t.members.map((m) => m.agentName),
    }));
    rooms.push({
      teamId: null, title: "Lobby · Sem time", emoji: "🛋️", color: "#71717a", accent: false,
      tx: 0, ty: 0, tw: 0, th: 0, members: overview.loose,
    });

    const maxRows = Math.max(2, ...rooms.map((e) => Math.ceil(e.members.length / 2)));
    const roomH = 2 + 1 + maxRows * DESK_H;
    rooms.forEach((e, i) => {
      e.tw = ROOM_W;
      e.th = roomH;
      e.tx = GAP + (i % ROOMS_PER_ROW) * (ROOM_W + GAP);
      e.ty = GAP + Math.floor(i / ROOMS_PER_ROW) * (roomH + GAP);
    });
    roomsRef.current = rooms;

    const next = new Map<string, CharState>();
    for (const room of rooms) {
      room.members.forEach((name, idx) => {
        const d = deskTile(room, idx);
        const homeX = (d.tx + DESK_W / 2) * TILE;
        const homeY = (d.ty + 2) * TILE;
        const prev = charsRef.current.get(name);
        next.set(name, {
          name, room,
          shirt: overview.appearances[name]?.color ?? null,
          homeX, homeY,
          x: prev?.x ?? homeX, y: prev?.y ?? homeY,
          tx: homeX, ty: homeY,
          phase: prev?.phase ?? Math.floor(homeX + homeY) % 100,
          wanderAt: 0, walking: false,
        });
      });
    }
    charsRef.current = next;
    charListRef.current = [...next.values()];

    const cols = ROOMS_PER_ROW * ROOM_W + (ROOMS_PER_ROW + 1) * GAP;
    const roomRows = Math.ceil(rooms.length / ROOMS_PER_ROW);
    const rowsTiles = roomRows * roomH + (roomRows + 1) * GAP;
    const w = cols * TILE * SCALE;
    const h = rowsTiles * TILE * SCALE;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    }

    const stat = document.createElement("canvas");
    stat.width = w; stat.height = h;
    const sctx = stat.getContext("2d");
    if (sctx) {
      sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      sctx.imageSmoothingEnabled = false;
      drawStatic(sctx, rooms, cols * TILE, rowsTiles * TILE);
    }
    staticRef.current = stat;
  }, [overview]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const render = (t: number) => {
      const status = statusRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const list = charListRef.current;
      for (const c of list) {
        const st = status(c.name);
        if (st === "idle") {
          if (t > c.wanderAt) {
            if (c.walking) {
              c.tx = c.homeX; c.ty = c.homeY; c.walking = false; c.wanderAt = t + 2000 + (c.phase % 30) * 120;
            } else {
              c.tx = (c.room.tx + 1) * TILE + 4 + Math.random() * ((c.room.tw - 2) * TILE - 8);
              c.ty = (c.room.ty + 2) * TILE + Math.random() * ((c.room.th - 3) * TILE);
              c.walking = true; c.wanderAt = t + 1600;
            }
          }
        } else {
          c.tx = c.homeX; c.ty = c.homeY;
        }
        const dx = c.tx - c.x, dy = c.ty - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1.2) {
          c.x += (dx / dist) * 0.5;
          c.y += (dy / dist) * 0.5;
          c.walking = st === "idle";
        } else {
          c.walking = false;
        }
      }
      list.sort((a, b) => a.y - b.y);
      for (const c of list) drawCharacter(ctx, c, status(c.name), t);

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
    const hit = (lx: number, ly: number): CharState | null => {
      for (const c of charListRef.current) {
        if (Math.abs(lx - c.x) <= 8 && ly >= c.y - 10 && ly <= c.y + 12) return c;
      }
      return null;
    };
    const roomAt = (lx: number, ly: number): RoomLayout | null => {
      for (const r of roomsRef.current) {
        if (lx >= r.tx * TILE && lx <= (r.tx + r.tw) * TILE && ly >= r.ty * TILE && ly <= (r.ty + r.th) * TILE) return r;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const c = hit(x, y);
      if (c) dragRef.current = { name: c.name, mx: x, my: y, moved: false };
    };
    const onMoveEvt = (e: PointerEvent) => {
      const { x, y } = toLogical(e);
      const tip = tooltipRef.current;
      const d = dragRef.current;
      if (d) {
        const c = charsRef.current.get(d.name);
        if (c) { c.x = x; c.y = y; c.tx = x; c.ty = y; }
        if (Math.abs(x - d.mx) > 3 || Math.abs(y - d.my) > 3) d.moved = true;
        canvas.style.cursor = "grabbing";
      } else {
        canvas.style.cursor = hit(x, y) ? "pointer" : "default";
      }
      if (tip) {
        const name = d?.name ?? hit(x, y)?.name;
        if (name) {
          tip.textContent = name;
          tip.style.display = "block";
          tip.style.left = `${e.clientX + 12}px`;
          tip.style.top = `${e.clientY + 12}px`;
        } else {
          tip.style.display = "none";
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      canvas.style.cursor = "default";
      if (!d) return;
      const { x, y } = toLogical(e);
      const c = charsRef.current.get(d.name);
      if (!d.moved) { navigate(`/agents/${d.name}`); return; }
      if (!adminRef.current) { if (c) { c.x = c.homeX; c.y = c.homeY; } return; }
      const room = roomAt(x, y);
      const ov = overviewRef.current;
      const currentTeam = ov.teams.find((tm) => tm.members.some((m) => m.agentName === d.name));
      const targetTeamId = room ? room.teamId : (currentTeam?.id ?? null);
      if ((currentTeam?.id ?? null) !== targetTeamId) onMoveRef.current(d.name, targetTeamId);
      else if (c) { c.x = c.homeX; c.y = c.homeY; }
    };

    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMoveEvt);
    window.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
    };
  }, [navigate]);

  return (
    <div className="relative overflow-auto rounded-lg border border-border bg-[#0a0a0f] p-3 max-h-[72vh]">
      <canvas ref={canvasRef} className="pixel-art block" style={{ imageRendering: "pixelated" }} />
      <div ref={tooltipRef} className="fixed z-50 hidden pointer-events-none rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white" />
    </div>
  );
}

const SHELF_BOOKS = ["#c0392b", "#27ae60", "#2980b9", "#f39c12", "#8e44ad"];

function drawStatic(ctx: CanvasRenderingContext2D, rooms: RoomLayout[], wLogical: number, hLogical: number) {
  const px = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, wLogical, hLogical);

  for (const room of rooms) {
    const rx = room.tx * TILE, ry = room.ty * TILE, rw = room.tw * TILE, rh = room.th * TILE;
    for (let ty2 = 0; ty2 < room.th; ty2++) {
      for (let tx2 = 0; tx2 < room.tw; tx2++) {
        const checker = (tx2 + ty2) % 2 === 0;
        ctx.fillStyle = room.accent ? (checker ? `${room.color}26` : `${room.color}18`) : (checker ? "#6b4a2b" : "#5e4126");
        ctx.fillRect(rx + tx2 * TILE, ry + ty2 * TILE, TILE, TILE);
      }
    }
    const wall = room.accent ? "#2a2730" : "#3a2817";
    const wallTop = room.accent ? "#3a3640" : "#4a341f";
    px(rx, ry, rw, TILE, wallTop);
    px(rx, ry + rh - 6, rw, 6, wall);
    px(rx, ry, TILE, rh, wall);
    px(rx + rw - TILE, ry, TILE, rh, wall);
    ctx.fillStyle = room.accent ? `${room.color}cc` : "#caa46a";
    ctx.fillRect(rx + TILE, ry + 3, rw - 2 * TILE, 2);

    const ix = (room.tx + 1) * TILE;
    const iy = (room.ty + 1) * TILE + 2;
    for (let s = 0; s < (room.tw - 2) * 2; s++) px(ix + s * 4, iy, 3, 8, SHELF_BOOKS[s % SHELF_BOOKS.length]);
    px(ix, iy + 8, (room.tw - 2) * TILE, 2, "#3a2817");

    const plx = rx + rw - TILE - 10, ply = ry + rh - 18;
    px(plx + 2, ply + 8, 6, 6, "#b56a4a");
    px(plx, ply + 2, 4, 5, "#3f9d52");
    px(plx + 5, ply, 4, 6, "#2f7d3f");
    px(plx + 2, ply + 4, 5, 4, "#3f9d52");

    room.members.forEach((_name, idx) => {
      const d = deskTile(room, idx);
      const dx = d.tx * TILE, dy = d.ty * TILE;
      px(dx + TILE, dy, 14, 9, "#2a2f3a");
      px(dx + TILE + 1, dy + 1, 12, 6, "#10151f");
      ctx.fillStyle = "#2b3a55";
      ctx.fillRect(dx + TILE + 3, dy + 2, 6, 1);
      px(dx + 2, dy + 9, DESK_W * TILE - 4, 4, "#8b5e34");
      px(dx + 2, dy + 13, DESK_W * TILE - 4, 3, "#7a5230");
    });
  }
}

function drawCharacter(ctx: CanvasRenderingContext2D, c: CharState, status: AgentLiveStatus, t: number) {
  const p = pixelPalette(c.name, c.shirt);
  const px = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const bob = status === "running"
    ? Math.round(Math.sin(t / 90 + c.phase))
    : c.walking ? (Math.floor(t / 140 + c.phase) % 2) : Math.round(Math.sin(t / 600 + c.phase));
  const x = Math.round(c.x);
  const y = Math.round(c.y) + bob;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const step = c.walking ? (Math.floor(t / 140 + c.phase) % 2 ? 1 : -1) : 0;
  px(x - 4, y + 7 - step, 3, 5, "#20242e");
  px(x + 1, y + 7 + step, 3, 5, "#20242e");
  px(x - 5, y - 1, 10, 9, p.shirt);
  px(x - 6, y, 2, 6, p.shirt);
  px(x + 4, y, 2, 6, p.shirt);
  px(x - 5, y - 8, 10, 8, p.hair);
  px(x - 4, y - 3, 8, 4, p.skin);
  px(x - 3, y - 1, 1, 1, "#20242e");
  px(x + 2, y - 1, 1, 1, "#20242e");

  if (status === "waiting") {
    const bx = x + 5, by = y - 16 + Math.round(Math.sin(t / 200));
    px(bx, by, 12, 9, "#ffffff");
    px(bx + 2, by + 9, 3, 2, "#ffffff");
    ctx.fillStyle = "#111";
    ctx.fillRect(bx + 5, by + 2, 2, 3);
    ctx.fillRect(bx + 5, by + 6, 2, 2);
  } else if (status === "running") {
    const bx = x + 5, by = y - 15;
    px(bx, by, 13, 9, "#1d2735");
    ctx.fillStyle = "#5fd0ff";
    const dots = Math.floor(t / 200) % 3 + 1;
    for (let i = 0; i < dots; i++) ctx.fillRect(bx + 2 + i * 3, by + 4, 2, 2);
  }
}
