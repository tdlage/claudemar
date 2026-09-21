import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { json, Router, type ErrorRequestHandler, type Request } from "express";
import { config } from "../../config.js";
import { safeProjectPath } from "../../session.js";
import { getAgentPaths, isValidAgentName } from "../../agents/manager.js";

export const confidentialAttachmentsRouter = Router();
confidentialAttachmentsRouter.use(json({ limit: "512kb" }));

function attachmentDirectory(req: Request, base: unknown): string | null {
  if (!req.ctx || typeof base !== "string") return null;
  const [type, name, extra] = base.split(":");
  if (extra !== undefined) return null;
  if (base === "orchestrator") {
    if (req.ctx.role !== "admin") return null;
    if (!existsSync(config.orchestratorPath)) return null;
  } else if (type === "project" && name && safeProjectPath(name)) {
    if (req.ctx.role === "user" && !req.ctx.projects.includes(name)) return null;
    if (!existsSync(safeProjectPath(name)!)) return null;
  } else if (type === "agent" && name && isValidAgentName(name) && getAgentPaths(name)) {
    if (req.ctx.role === "user" && !req.ctx.agents.includes(name)) return null;
    if (!existsSync(getAgentPaths(name)!.root)) return null;
  } else return null;
  const owner = req.ctx.role === "admin" ? "admin" : req.ctx.userId;
  const scope = createHash("sha256").update(JSON.stringify([owner, base])).digest("hex");
  return resolve(config.dataPath, "confidential-attachments", scope);
}

confidentialAttachmentsRouter.post("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const directory = attachmentDirectory(req, req.body?.base);
  if (!directory) { res.status(403).json({ error: "Destino não autorizado." }); return; }
  const content = req.body?.content;
  if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > 64 * 1024) {
    res.status(400).json({ error: "Informe um conteúdo de até 64 KB." }); return;
  }
  const id = randomUUID();
  const path = resolve(directory, `${id}.txt`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    res.status(201).json({
      id,
      instruction: `[Arquivo confidencial anexado: ${JSON.stringify(path)}]\nUse este arquivo somente para a tarefa solicitada. Não reproduza seu conteúdo em respostas, logs, saídas de ferramentas ou comandos visíveis. Prefira carregar os valores diretamente do arquivo no processo que precisar deles, sem imprimi-los. Não copie o arquivo para o repositório, memória ou documentação e não faça commit de credenciais. Se precisar ler o conteúdo para compreender a tarefa, trate-o como confidencial.`,
    });
  } catch {
    res.status(500).json({ error: "Não foi possível salvar o arquivo confidencial." });
  }
});

confidentialAttachmentsRouter.delete("/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const directory = attachmentDirectory(req, req.query.base);
  if (!directory) { res.status(403).json({ error: "Destino não autorizado." }); return; }
  const id = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    res.status(400).json({ error: "Anexo inválido." }); return;
  }
  try {
    await unlink(resolve(directory, `${id}.txt`));
    res.json({ removed: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { res.json({ removed: true }); return; }
    res.status(500).json({ error: "Não foi possível remover o arquivo confidencial." });
  }
});

const privateErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: "Não foi possível processar o arquivo confidencial." });
};
confidentialAttachmentsRouter.use(privateErrorHandler);
