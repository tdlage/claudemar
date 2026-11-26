import { Router, type Request, type Response } from "express";
import { availabilityOf, type Availability } from "../execution-availability.js";
import { asyncHandler } from "../route-utils.js";
import {
  advanceToNext,
  answerExercise,
  appealExercise,
  continueLesson,
  CourseRejection,
  courseOverview,
  goToLesson,
  readState,
  retryPreparation,
  startCourse,
  vocabularyOverview,
  type Context,
  type CourseState,
  type Rejection,
} from "../../spanish/course.js";
import { isTimeZone } from "../../spanish/srs.js";

const OWNER = "admin";

const UNAVAILABLE: Record<Exclude<Availability, "playable">, string> = {
  "not-running": "A aula fica disponível apenas enquanto um prompt está em execução.",
  "awaiting-input": "A execução está esperando sua resposta.",
};

const REJECTIONS: Record<Rejection, { status: number; error: string }> = {
  "no-course": { status: 409, error: "O curso ainda não foi criado." },
  "out-of-sync": { status: 409, error: "A aula mudou em outra janela." },
  "invalid-answer": { status: 422, error: "Resposta inválida." },
  "locked-lesson": { status: 403, error: "Essa aula ainda não foi liberada." },
  "not-ready": { status: 409, error: "Termine este exercício antes de continuar." },
  "course-finished": { status: 409, error: "Você concluiu a última aula do curso." },
};

export const spanishRouter = Router();

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function contextOf(timeZone: unknown, allowJobs: boolean): Context {
  return { owner: OWNER, allowJobs, timeZone: isTimeZone(timeZone) ? timeZone : "UTC", now: new Date() };
}

async function respond(res: Response, ctx: Context, run: () => Promise<CourseState>): Promise<void> {
  try {
    res.json({ state: await run() });
  } catch (error) {
    if (!(error instanceof CourseRejection)) throw error;
    const rejection = REJECTIONS[error.reason];
    res.status(rejection.status).json({ error: rejection.error, reason: error.reason, state: await readState({ ...ctx, allowJobs: false }) });
  }
}

function mutation(run: (ctx: Context, body: Record<string, unknown>) => Promise<CourseState>) {
  return asyncHandler(async (req, res) => {
    const body = bodyOf(req);
    const availability = availabilityOf(req.ctx!, body.execId);
    if (availability !== "playable") {
      res.status(409).json({ error: UNAVAILABLE[availability], availability });
      return;
    }
    const ctx = contextOf(body.timeZone, true);
    await respond(res, ctx, () => run(ctx, body));
  });
}

function overview<T>(load: (ctx: Context) => Promise<T>) {
  return asyncHandler(async (req, res) => {
    const ctx = contextOf(req.query.timeZone, false);
    try {
      res.json(await load(ctx));
    } catch (error) {
      if (!(error instanceof CourseRejection)) throw error;
      const rejection = REJECTIONS[error.reason];
      res.status(rejection.status).json({ error: rejection.error, reason: error.reason });
    }
  });
}

spanishRouter.get("/", asyncHandler(async (req, res) => {
  const availability = availabilityOf(req.ctx!, req.query.execId);
  const ctx = contextOf(req.query.timeZone, availability === "playable");
  res.json({ state: await readState(ctx), availability });
}));

spanishRouter.post("/start", mutation((ctx) => startCourse(ctx)));

spanishRouter.post("/continue", mutation((ctx, { lessonId, cursor }) => continueLesson(ctx, lessonId, cursor)));

spanishRouter.post("/answer", mutation((ctx, { lessonId, index, answer }) => answerExercise(ctx, lessonId, index, answer)));

spanishRouter.post("/appeal", mutation((ctx, { lessonId, index }) => appealExercise(ctx, lessonId, index)));

spanishRouter.post("/next", mutation((ctx) => advanceToNext(ctx)));

spanishRouter.post("/goto", mutation((ctx, { unit, step }) => goToLesson(ctx, { unit, step })));

spanishRouter.post("/retry", mutation((ctx) => retryPreparation(ctx)));

spanishRouter.get("/course", overview(courseOverview));

spanishRouter.get("/vocabulary", overview(vocabularyOverview));
