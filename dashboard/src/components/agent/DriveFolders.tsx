import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye, FileText, HardDrive, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import { FilePreviewModal } from "../shared/FilePreviewModal";
import { ConnectDriveFolderModal } from "./ConnectDriveFolderModal";
import { listenDriveAuthorization, openDriveAuthorization } from "../../lib/googleDriveAuth";
import type { DriveAccess, DriveFolderFiles, DriveFolderLink, DriveFoldersResponse, DriveMirroredFile } from "../../lib/types";

interface DriveFoldersProps {
  agentName: string;
  onChanged: () => void;
}

const POLL_MS = 3000;
const GRANT_TIMEOUT_MS = 5 * 60_000;
const ACCESS_LABELS: Record<DriveAccess, string> = { read: "Read only", write: "Read & write" };
const iconButton = "p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function StatusBadge({ folder }: { folder: DriveFolderLink }) {
  if (folder.syncing) return <Badge variant="info">Syncing…</Badge>;
  if (folder.reauthRequired) return <Badge variant="warning">Reconnect required</Badge>;
  if (folder.status === "error") return <Badge variant="danger">Sync failed</Badge>;
  if (folder.status === "pending") return <Badge>Pending</Badge>;
  return <Badge variant="success">Synced</Badge>;
}

function FolderFiles({ basePath, folder }: { basePath: string; folder: DriveFolderLink }) {
  const { addToast } = useToast();
  const [data, setData] = useState<DriveFolderFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DriveMirroredFile | null>(null);
  const filesPath = `${basePath}/${folder.id}/files`;
  const downloadUrl = (file: DriveMirroredFile) => `/api${filesPath}/${encodeURIComponent(file.id)}/download`;

  useEffect(() => {
    api.get<DriveFolderFiles>(filesPath)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Failed to load files")));
  }, [filesPath, folder.lastSyncedAt]);

  const download = async (file: DriveMirroredFile) => {
    try {
      const token = localStorage.getItem("dashboard_token") || "";
      const res = await fetch(downloadUrl(file), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName(file.path);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast("error", "Failed to download file");
    }
  };

  if (error) return <p role="alert" className="text-xs text-red-400">{error}</p>;
  if (!data) return <div role="status" className="flex items-center gap-2 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> Loading files…</div>;

  return (
    <div className="space-y-2 border-t border-border pt-2">
      {data.files.length === 0 ? (
        <p className="text-xs text-text-muted">No files mirrored yet.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-border">
          {data.files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-1.5">
              <FileText size={13} className="text-text-muted shrink-0" />
              <span className="text-xs text-text-primary truncate flex-1" title={file.path}>{file.path}</span>
              <span className="text-xs text-text-muted whitespace-nowrap">{formatBytes(file.size)}</span>
              <button type="button" onClick={() => setPreview(file)} className={iconButton} title="Preview" aria-label={`Preview ${file.path}`}>
                <Eye size={13} />
              </button>
              <button type="button" onClick={() => download(file)} className={iconButton} title="Download" aria-label={`Download ${file.path}`}>
                <Download size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.skipped.length > 0 && (
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">{data.skipped.length} file(s) not synced</summary>
          <ul className="mt-1 space-y-1 max-h-48 overflow-y-auto">
            {data.skipped.map((entry) => (
              <li key={`${entry.id}:${entry.path}`}>
                <span className="text-text-secondary">{entry.path}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview && (
        <FilePreviewModal onClose={() => setPreview(null)} fileName={fileName(preview.path)} size={preview.size} url={downloadUrl(preview)} />
      )}
    </div>
  );
}

export function DriveFolders({ agentName, onChanged }: DriveFoldersProps) {
  const { addToast } = useToast();
  const [state, setState] = useState<DriveFoldersResponse | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DriveFolderLink | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingAccess, setChangingAccess] = useState<string | null>(null);
  const stopGrantListener = useRef<(() => void) | null>(null);
  const basePath = `/agents/${agentName}/drive-folders`;

  const load = useCallback(() => {
    api.get<DriveFoldersResponse>(basePath).then(setState).catch(() => {});
  }, [basePath]);

  useEffect(load, [load]);

  useEffect(() => () => stopGrantListener.current?.(), []);

  const syncing = state?.folders.some((folder) => folder.syncing) ?? false;
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [syncing, load]);

  const refreshAll = () => {
    load();
    onChanged();
  };

  const syncNow = async (folder: DriveFolderLink) => {
    try {
      const updated = await api.post<DriveFolderLink>(`${basePath}/${folder.id}/sync`);
      setState((previous) => previous && { ...previous, folders: previous.folders.map((f) => (f.id === updated.id ? updated : f)) });
    } catch (err) {
      addToast("error", errorMessage(err, "Failed to start sync"));
    }
  };

  const replaceFolder = (updated: DriveFolderLink) => {
    setState((previous) => previous && { ...previous, folders: previous.folders.map((f) => (f.id === updated.id ? updated : f)) });
  };

  const applyAccess = async (folder: DriveFolderLink, access: DriveAccess) => {
    setChangingAccess(folder.id);
    try {
      replaceFolder(await api.patch<DriveFolderLink>(`${basePath}/${folder.id}`, { access }));
      addToast("success", `"${folder.folderName}" is now ${ACCESS_LABELS[access].toLowerCase()} for this agent`);
    } catch (err) {
      addToast("error", errorMessage(err, "Failed to change the permission"));
    } finally {
      setChangingAccess(null);
    }
  };

  const grantWriteThenApply = async (folder: DriveFolderLink, accountId: string) => {
    stopGrantListener.current?.();
    const stopListening = listenDriveAuthorization((event) => {
      if (event.type !== "connected" && event.type !== "error") return;
      stop();
      if (event.type === "connected") void applyAccess(folder, "write");
      else addToast("error", event.message || "Google authorization failed");
    });
    const timeout = setTimeout(() => stop(), GRANT_TIMEOUT_MS);
    const stop = () => {
      clearTimeout(timeout);
      stopListening();
      if (stopGrantListener.current === stop) stopGrantListener.current = null;
    };
    stopGrantListener.current = stop;
    try {
      await openDriveAuthorization({ agentName, write: true, accountId });
      addToast("success", "Allow write access in the Google window to finish");
    } catch (err) {
      stop();
      addToast("error", errorMessage(err, "Failed to start Google authorization"));
    }
  };

  const changeAccess = (folder: DriveFolderLink, access: DriveAccess) => {
    if (access === folder.access) return;
    if (access === "write" && folder.accountCanWrite === false && folder.accountId) {
      void grantWriteThenApply(folder, folder.accountId);
      return;
    }
    void applyAccess(folder, access);
  };

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`${basePath}/${removeTarget.id}`);
      addToast("success", `Removed "${removeTarget.folderName}"`);
      if (expanded === removeTarget.id) setExpanded(null);
      setRemoveTarget(null);
      refreshAll();
    } catch (err) {
      addToast("error", errorMessage(err, "Failed to remove folder"));
    } finally {
      setRemoving(false);
    }
  };

  const folders = state?.folders ?? [];

  return (
    <section className="space-y-2" aria-label="Google Drive folders">
      <div className="flex items-center gap-2">
        <HardDrive size={14} className="text-text-muted" />
        <h3 className="text-sm font-medium">Google Drive</h3>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setConnectOpen(true)}>
          <Plus size={13} /> Connect folder
        </Button>
      </div>

      {state && folders.length === 0 && (
        <p className="text-sm text-text-muted">
          {state.configured
            ? "No Google Drive folders connected. Share a folder from your Drive and its files become inputs for this agent."
            : "Google Drive is not configured on this server."}
        </p>
      )}

      {folders.map((folder) => (
        <Card key={folder.id} className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(expanded === folder.id ? null : folder.id)}
              className={iconButton}
              aria-expanded={expanded === folder.id}
              aria-label={`${expanded === folder.id ? "Hide" : "Show"} files of ${folder.folderName}`}
              title={expanded === folder.id ? "Hide files" : "Show files"}
            >
              {expanded === folder.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <a href={folder.folderUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline truncate" title="Open in Google Drive">
              {folder.folderName}
            </a>
            <StatusBadge folder={folder} />
            {!folder.canManage && <Badge variant={folder.access === "write" ? "accent" : "default"}>{ACCESS_LABELS[folder.access]}</Badge>}
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {folder.canManage && (
                <select
                  aria-label={`Agent permission for ${folder.folderName}`}
                  value={folder.access}
                  disabled={changingAccess === folder.id}
                  onChange={(e) => changeAccess(folder, e.target.value as DriveAccess)}
                  title={folder.isOwner ? "Agent permission on this folder" : "Only the person who shared this folder can give the agent write permission"}
                  className={`text-xs bg-transparent border rounded-md px-1.5 py-1 focus:outline-none focus:border-accent ${folder.access === "write" ? "border-accent/40 text-accent" : "border-border text-text-muted"}`}
                >
                  <option value="read">{ACCESS_LABELS.read}</option>
                  <option value="write" disabled={!folder.isOwner}>{ACCESS_LABELS.write}</option>
                </select>
              )}
              <button
                type="button"
                onClick={() => syncNow(folder)}
                disabled={folder.syncing || folder.reauthRequired}
                className={iconButton}
                title="Sync now"
                aria-label={`Sync ${folder.folderName} now`}
              >
                <RefreshCw size={14} className={folder.syncing ? "animate-spin" : ""} />
              </button>
              {folder.canManage && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(folder)}
                  className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                  title="Remove"
                  aria-label={`Remove ${folder.folderName}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
            <span className="font-mono">{folder.localPath}</span>
            <span>{folder.fileCount} file(s) · {formatBytes(folder.totalBytes)}</span>
            {folder.skippedCount > 0 && <span>{folder.skippedCount} not synced</span>}
            <span>
              {folder.lastSyncedAt ? `Synced ${formatDistanceToNow(new Date(folder.lastSyncedAt), { addSuffix: true })}` : "Not synced yet"}
            </span>
            <span>Shared by {folder.ownerName}{folder.accountEmail ? ` (${folder.accountEmail})` : ""}</span>
          </div>
          {folder.message && (
            <p className={`text-xs ${folder.status === "error" ? "text-red-400" : "text-amber-400"}`}>{folder.message}</p>
          )}
          {expanded === folder.id && <FolderFiles basePath={basePath} folder={folder} />}
        </Card>
      ))}

      {connectOpen && state && (
        <ConnectDriveFolderModal
          agentName={agentName}
          syncIntervalMinutes={state.syncIntervalMinutes}
          onClose={() => setConnectOpen(false)}
          onChanged={refreshAll}
        />
      )}

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Remove Google Drive folder" dismissible={!removing}>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Stop sharing <strong className="text-text-primary">{removeTarget?.folderName}</strong> with this agent? Its mirrored files are
            deleted from the agent's inputs. Nothing is deleted from Google Drive.
            {removeTarget?.access === "write" && " Changes the agent has not uploaded yet are uploaded first."}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={removing} onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button size="sm" variant="danger" disabled={removing} onClick={remove}>{removing ? "Removing…" : "Remove"}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
