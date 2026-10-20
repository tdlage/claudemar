import { mkdir } from "node:fs/promises";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { resolveAttachmentTarget } from "../attachment-target.js";
import { MAX_INPUT_FILE_BYTES } from "../route-utils.js";
import {
  AttachmentLimitError,
  promptAttachmentsDir,
  removePromptAttachment,
  savePromptAttachment,
} from "../../prompt-attachments.js";

const MEDIA_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/;

export const promptAttachmentsRouter = Router();

function attachmentOwner(req: Request): string | null {
  if (!req.ctx) return null;
  return req.ctx.role === "admin" ? "admin" : req.ctx.name;
}

function attachmentDirectory(req: Request): string | null {
  const target = resolveAttachmentTarget(req, req.query.base);
  const owner = attachmentOwner(req);
  return target && owner ? promptAttachmentsDir(target.targetType, target.targetName, owner) : null;
}

promptAttachmentsRouter.post("/", async (req, res) => {
  const directory = attachmentDirectory(req);
  if (!directory) { res.status(403).json({ error: "Destino não autorizado." }); return; }
  const { filename, type } = req.query;
  if (typeof filename !== "string" || !filename.trim()) { res.status(400).json({ error: "Informe o nome do arquivo." }); return; }
  if (Number(req.headers["content-length"] ?? 0) > MAX_INPUT_FILE_BYTES) {
    res.status(413).json({ error: `Arquivo maior que ${MAX_INPUT_FILE_BYTES / (1024 * 1024)} MB.` });
    return;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const attachment = await savePromptAttachment({
    dir: directory,
    originalName: filename,
    mediaType: typeof type === "string" && MEDIA_TYPE_RE.test(type) ? type : "",
    body: req,
    maxBytes: MAX_INPUT_FILE_BYTES,
  });
  res.status(201).json(attachment);
});

promptAttachmentsRouter.delete("/:id", async (req, res) => {
  const directory = attachmentDirectory(req);
  if (!directory) { res.status(403).json({ error: "Destino não autorizado." }); return; }
  if (!(await removePromptAttachment(directory, String(req.params.id)))) { res.status(400).json({ error: "Anexo inválido." }); return; }
  res.json({ removed: true });
});

const uploadErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AttachmentLimitError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "Não foi possível salvar o anexo." });
};
promptAttachmentsRouter.use(uploadErrorHandler);
