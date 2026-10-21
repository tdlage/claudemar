import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Request, Response, Router } from "express";
import { config } from "../../config.js";
import { getAgentPaths, isValidAgentName } from "../../agents/manager.js";
import { DRIVE_ID_PATTERN } from "../../google-drive/drive-api.js";
import { driveOAuthConfigured } from "../../google-drive/oauth.js";
import {
  agentFolderViews,
  connectFolder,
  disconnectFolder,
  DriveRequestError,
  mirroredFile,
  mirroredFiles,
  requestSync,
  setFolderAccess,
} from "../../google-drive/service.js";
import { isDriveAccess } from "../../google-drive/store.js";
import { driveRoute } from "./google-drive.js";

function agentName(req: Request): string {
  const { name } = req.params;
  if (typeof name !== "string" || !isValidAgentName(name)) throw new DriveRequestError(400, "Invalid agent name");
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) throw new DriveRequestError(404, "Agent not found");
  return name;
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== "string" || !value) throw new DriveRequestError(400, `Invalid ${key}`);
  return value;
}

export function registerDriveFolderRoutes(router: Router): void {
  router.get("/:name/drive-folders", driveRoute(async (req: Request, res: Response) => {
    const name = agentName(req);
    res.json({
      configured: driveOAuthConfigured(),
      syncIntervalMinutes: config.googleDriveSyncIntervalMinutes,
      folders: agentFolderViews(req.ctx!, name),
    });
  }));

  router.post("/:name/drive-folders", driveRoute(async (req, res) => {
    const name = agentName(req);
    const { accountId, folderId, access = "read" } = (req.body ?? {}) as { accountId?: unknown; folderId?: unknown; access?: unknown };
    if (typeof accountId !== "string" || !accountId) throw new DriveRequestError(400, "accountId is required");
    if (typeof folderId !== "string" || !DRIVE_ID_PATTERN.test(folderId)) throw new DriveRequestError(400, "Invalid folderId");
    if (!isDriveAccess(access)) throw new DriveRequestError(400, "access must be read or write");
    res.status(201).json(await connectFolder(req.ctx!, name, accountId, folderId, access));
  }));

  router.patch("/:name/drive-folders/:id", driveRoute(async (req, res) => {
    const { access } = (req.body ?? {}) as { access?: unknown };
    if (!isDriveAccess(access)) throw new DriveRequestError(400, "access must be read or write");
    res.json(await setFolderAccess(req.ctx!, agentName(req), param(req, "id"), access));
  }));

  router.post("/:name/drive-folders/:id/sync", driveRoute(async (req, res) => {
    res.json(requestSync(req.ctx!, agentName(req), param(req, "id")));
  }));

  router.delete("/:name/drive-folders/:id", driveRoute(async (req, res) => {
    await disconnectFolder(req.ctx!, agentName(req), param(req, "id"));
    res.json({ removed: true });
  }));

  router.get("/:name/drive-folders/:id/files", driveRoute(async (req, res) => {
    res.json(await mirroredFiles(agentName(req), param(req, "id")));
  }));

  router.get("/:name/drive-folders/:id/files/:fileId/download", driveRoute(async (req, res) => {
    const file = await mirroredFile(agentName(req), param(req, "id"), param(req, "fileId"));
    const handle = file ? await open(file.absolutePath, "r").catch(() => null) : null;
    if (!file || !handle) throw new DriveRequestError(404, "File not found");
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new DriveRequestError(404, "File not found");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.setHeader("Content-Length", info.size);
      await pipeline(handle.createReadStream({ autoClose: false }), res);
    } finally {
      await handle.close();
    }
  }));
}
