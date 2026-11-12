import { raw, type Request, type Response, type Router } from "express";
import { isValidAgentName } from "../../agents/manager.js";
import {
  createSkill,
  getAgentSkill,
  installFromGithub,
  installFromLibrary,
  installFromUpload,
  listAgentSkills,
  listLibrarySkills,
  removeSkill,
  SKILL_INVOCATIONS,
  SkillError,
  updateSkill,
  type SkillInput,
  type SkillInvocation,
} from "../../agents/skills.js";
import { MAX_ARCHIVE_BYTES } from "../../agents/skill-archive.js";

const skillUploadParser = raw({ type: "application/octet-stream", limit: MAX_ARCHIVE_BYTES });
const MAX_INSTRUCTIONS_LENGTH = 200_000;

function skillRoute(handler: (req: Request, res: Response) => Promise<void> | void): (req: Request, res: Response) => void {
  return (req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        if (res.headersSent) return;
        if (err instanceof SkillError) {
          res.status(err.status).json({ error: err.message, ...(err.details ?? {}) });
          return;
        }
        console.error("[skills] request failed:", err instanceof Error ? err.message : String(err));
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
  };
}

function agentName(req: Request): string {
  const name = req.params.name;
  if (typeof name !== "string" || !isValidAgentName(name)) throw new SkillError(400, "Nome de agente inválido");
  return name;
}

function skillName(req: Request): string {
  const name = req.params.skill;
  if (typeof name !== "string" || !name) throw new SkillError(400, "Skill inválida");
  return name;
}

function textField(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new SkillError(400, `${key} inválido`);
  if (value.length > max) throw new SkillError(400, `${key} grande demais`);
  return value.trim();
}

function skillInput(body: unknown): SkillInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const invocation = data.invocation ?? "auto";
  if (!SKILL_INVOCATIONS.includes(invocation as SkillInvocation)) throw new SkillError(400, "Modo de acionamento inválido");
  return {
    description: textField(data, "description", 4000),
    whenToUse: textField(data, "whenToUse", 4000),
    invocation: invocation as SkillInvocation,
    instructions: textField(data, "instructions", MAX_INSTRUCTIONS_LENGTH),
  };
}

export function registerAgentSkillRoutes(router: Router): void {
  router.get("/:name/skills", skillRoute((req, res) => {
    res.json({ skills: listAgentSkills(agentName(req)) });
  }));

  router.get("/:name/skill-library", skillRoute((req, res) => {
    res.json({ skills: listLibrarySkills(agentName(req)) });
  }));

  router.get("/:name/skills/:skill", skillRoute((req, res) => {
    res.json(getAgentSkill(agentName(req), skillName(req)));
  }));

  router.post("/:name/skills", skillRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    res.status(201).json(await createSkill(agentName(req), name, skillInput(body)));
  }));

  router.put("/:name/skills/:skill", skillRoute(async (req, res) => {
    res.json(await updateSkill(agentName(req), skillName(req), skillInput(req.body)));
  }));

  router.delete("/:name/skills/:skill", skillRoute(async (req, res) => {
    await removeSkill(agentName(req), skillName(req));
    res.json({ removed: true });
  }));

  router.post("/:name/skills-import/upload", skillUploadParser, skillRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new SkillError(400, "Envie o arquivo como application/octet-stream");
    res.status(201).json({ installed: await installFromUpload(agentName(req), req.body, req.query.replace === "1") });
  }));

  router.post("/:name/skills-import/github", skillRoute(async (req, res) => {
    const { url, names, replace } = (req.body ?? {}) as { url?: unknown; names?: unknown; replace?: unknown };
    if (typeof url !== "string" || !url.trim()) throw new SkillError(400, "Informe o endereço do GitHub");
    const selected = Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : null;
    res.json(await installFromGithub(agentName(req), url, selected, replace === true));
  }));

  router.post("/:name/skills-import/library", skillRoute(async (req, res) => {
    const { name, replace } = (req.body ?? {}) as { name?: unknown; replace?: unknown };
    if (typeof name !== "string" || !name) throw new SkillError(400, "Informe a skill");
    res.status(201).json({ installed: await installFromLibrary(agentName(req), name, replace === true) });
  }));
}
