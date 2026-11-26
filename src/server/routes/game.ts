import { Router, type Request, type Response } from "express";
import { usersManager } from "../../users-manager.js";
import { availabilityOf, type Availability } from "../execution-availability.js";
import { asyncHandler } from "../route-utils.js";
import type { RequestContext } from "../middleware.js";
import {
  assessBoard,
  chooseLevel,
  playMove,
  restartLevel,
  startProgress,
  undoMove,
  viewOf,
  type GameProgress,
  type Rejection,
  type Transition,
} from "../../game/progress.js";
import { loadProgress, loadRanking, saveProgress, withPlayerLock } from "../../game/store.js";

const ADMIN_PLAYER = "admin";
const RANKING_SIZE = 50;

const UNAVAILABLE: Record<Exclude<Availability, "playable">, string> = {
  "not-running": "O jogo fica disponível apenas enquanto um prompt está em execução.",
  "awaiting-input": "A execução está esperando sua resposta.",
};

const REJECTIONS: Record<Rejection, { status: number; error: string }> = {
  "out-of-sync": { status: 409, error: "O tabuleiro mudou em outra janela." },
  "invalid-move": { status: 422, error: "Jogada inválida." },
  "move-limit": { status: 409, error: "Esta tentativa chegou ao limite de jogadas. Reinicie a fase." },
  "locked-level": { status: 403, error: "Essa fase ainda não foi alcançada." },
};

export const gameRouter = Router();

function playerOf(ctx: RequestContext): string {
  return ctx.role === "admin" ? ADMIN_PLAYER : ctx.userId;
}

function playerName(player: string): string | null {
  return player === ADMIN_PLAYER ? "Administrador" : usersManager.get(player)?.name ?? null;
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function progressOf(player: string): Promise<GameProgress> {
  return (await loadProgress(player)) ?? (await startProgress(new Date()));
}

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function guard(req: Request, res: Response): string | null {
  const ctx = req.ctx!;
  const availability = availabilityOf(ctx, bodyOf(req).execId);
  if (availability === "playable") return playerOf(ctx);
  res.status(409).json({ error: UNAVAILABLE[availability], availability });
  return null;
}

function mutation(transition: (progress: GameProgress, body: Record<string, unknown>) => Transition | Promise<Transition>) {
  return asyncHandler(async (req, res) => {
    const player = guard(req, res);
    if (!player) return;
    const body = bodyOf(req);
    await withPlayerLock(player, async () => {
      const progress = await progressOf(player);
      const result = await transition(progress, body);
      if (!result.ok) {
        const rejection = REJECTIONS[result.reason];
        res.status(rejection.status).json({ error: rejection.error, reason: result.reason, state: viewOf(progress) });
        return;
      }
      await saveProgress(player, result.progress);
      res.json({ state: viewOf(result.progress), completed: result.completed ?? null });
    });
  });
}

gameRouter.get("/", asyncHandler(async (req, res) => {
  const ctx = req.ctx!;
  const progress = await progressOf(playerOf(ctx));
  res.json({ state: viewOf(progress), availability: availabilityOf(ctx, req.query.execId) });
}));

gameRouter.post("/move", mutation((progress, { from, to, index }) => {
  if (!isIndex(from) || !isIndex(to) || !isIndex(index)) return { ok: false, reason: "invalid-move" };
  return playMove(progress, [from, to], index, new Date());
}));

gameRouter.post("/undo", mutation((progress, { index }) => {
  if (!isIndex(index)) return { ok: false, reason: "invalid-move" };
  return undoMove(progress, index);
}));

gameRouter.post("/restart", mutation((progress) => restartLevel(progress)));

gameRouter.post("/level", mutation((progress, { level }) => chooseLevel(progress, level)));

gameRouter.post("/check", asyncHandler(async (req, res) => {
  const player = guard(req, res);
  if (!player) return;
  const { level, moves } = bodyOf(req);
  await withPlayerLock(player, async () => {
    const progress = await progressOf(player);
    if (level !== progress.level || moves !== progress.moves.length) {
      const rejection = REJECTIONS["out-of-sync"];
      res.status(rejection.status).json({ error: rejection.error, reason: "out-of-sync", state: viewOf(progress) });
      return;
    }
    res.json({ verdict: await assessBoard(progress), level: progress.level, moves: progress.moves.length });
  });
}));

gameRouter.get("/ranking", asyncHandler(async (req, res) => {
  const player = playerOf(req.ctx!);
  const entries = (await loadRanking())
    .map((record) => ({ record, name: playerName(record.player) }))
    .filter((entry): entry is { record: typeof entry.record; name: string } => entry.name !== null)
    .map(({ record, name }, index) => ({
      position: index + 1,
      name,
      maxLevel: record.maxLevel,
      levelsCompleted: record.levelsCompleted,
      reachedAt: record.reachedAt.toISOString(),
      me: record.player === player,
    }));
  res.json({ entries: entries.slice(0, RANKING_SIZE), me: entries.find((entry) => entry.me) ?? null, total: entries.length });
}));
