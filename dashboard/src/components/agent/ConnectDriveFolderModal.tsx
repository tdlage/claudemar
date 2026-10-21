import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Copy, Folder, HardDrive, Loader2, Plus, Search, Unplug } from "lucide-react";
import { api } from "../../lib/api";
import { useDebounce } from "../../hooks/useDebounce";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import type { DriveAccount, DriveAccountsResponse, DriveBrowseFolder, DriveBrowseResponse, DriveBrowseScope } from "../../lib/types";

interface ConnectDriveFolderModalProps {
  agentName: string;
  syncIntervalMinutes: number;
  onClose: () => void;
  onChanged: () => void;
}

const SCOPES: { key: DriveBrowseScope; label: string }[] = [
  { key: "my", label: "My Drive" },
  { key: "shared", label: "Shared with me" },
  { key: "drives", label: "Shared drives" },
];
const AUTH_CHANNEL = "claudemar-google-drive";
const AUTH_POPUP = "claudemar-google-drive";
const AUTH_TIMEOUT_MS = 5 * 60_000;
const AUTH_POLL_MS = 2500;

const inputClass = "w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function ConnectDriveFolderModal({ agentName, syncIntervalMinutes, onClose, onChanged }: ConnectDriveFolderModalProps) {
  const { addToast } = useToast();
  const [accountsState, setAccountsState] = useState<DriveAccountsResponse | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const [scope, setScope] = useState<DriveBrowseScope>("my");
  const [path, setPath] = useState<DriveBrowseFolder[]>([]);
  const [search, setSearch] = useState("");
  const query = useDebounce(search.trim(), 400);
  const [listing, setListing] = useState<DriveBrowseResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const knownAccounts = useRef(new Map<string, boolean>());
  const listRequest = useRef(0);

  const accounts = accountsState?.accounts ?? [];
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const browsableAccountId = account && !account.reauthRequired && !authorizing ? account.id : "";
  const current = path.length > 0 ? path[path.length - 1] : null;

  const loadAccounts = useCallback(async (): Promise<DriveAccount[] | null> => {
    try {
      const state = await api.get<DriveAccountsResponse>("/google-drive/accounts");
      setAccountsState(state);
      setAccountsError(null);
      return state.accounts;
    } catch (err) {
      setAccountsError(errorMessage(err, "Failed to load Google accounts"));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadAccounts().then((list) => {
      const usable = list?.find((a) => !a.reauthRequired) ?? list?.[0];
      if (usable) setAccountId(usable.id);
    });
  }, [loadAccounts]);

  const selectAccount = useCallback((id: string) => {
    setAccountId(id);
    setPath([]);
    setSearch("");
    setListing(null);
    setConfirmingDisconnect(false);
  }, []);

  const finishAuthorization = useCallback((connectedId: string) => {
    setAuthorizing(false);
    selectAccount(connectedId);
    addToast("success", "Google account connected");
  }, [addToast, selectAccount]);

  useEffect(() => {
    if (!authorizing) return;
    const detect = async (connectedId?: string) => {
      const list = await loadAccounts();
      if (!list) return;
      const connected = connectedId
        ? list.find((a) => a.id === connectedId)
        : list.find((a) => !knownAccounts.current.has(a.id) || (knownAccounts.current.get(a.id) && !a.reauthRequired));
      if (connected) finishAuthorization(connected.id);
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
    channel?.addEventListener("message", (event: MessageEvent<{ type?: string; message?: string; accountId?: string }>) => {
      if (event.data?.type === "error") {
        setAuthorizing(false);
        addToast("error", event.data.message || "Google authorization failed");
      } else if (event.data?.type === "connected") {
        void detect(event.data.accountId);
      }
    });
    const poll = setInterval(() => void detect(), AUTH_POLL_MS);
    const timeout = setTimeout(() => setAuthorizing(false), AUTH_TIMEOUT_MS);
    return () => {
      channel?.close();
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [authorizing, loadAccounts, finishAuthorization, addToast]);

  const startAuthorization = async () => {
    const popup = window.open("", AUTH_POPUP, "width=520,height=680");
    try {
      const { authUrl } = await api.post<{ authUrl: string }>("/google-drive/accounts/connect", { returnTo: `/agents/${agentName}` });
      knownAccounts.current = new Map(accounts.map((a) => [a.id, a.reauthRequired]));
      if (popup && !popup.closed) {
        popup.location.href = authUrl;
        setAuthorizing(true);
      } else {
        window.location.assign(authUrl);
      }
    } catch (err) {
      popup?.close();
      addToast("error", errorMessage(err, "Failed to start Google authorization"));
    }
  };

  const loadFolders = useCallback(async (pageToken?: string) => {
    if (!browsableAccountId) return;
    const request = ++listRequest.current;
    const params = new URLSearchParams({ scope });
    if (query) {
      params.set("q", query);
    } else if (current) {
      params.set("parent", current.id);
      if (current.driveId) params.set("driveId", current.driveId);
    }
    if (pageToken) params.set("pageToken", pageToken);
    setListLoading(true);
    setListError(null);
    try {
      const result = await api.get<DriveBrowseResponse>(`/google-drive/accounts/${browsableAccountId}/folders?${params}`);
      if (request !== listRequest.current) return;
      setListing((previous) => (pageToken && previous ? { folders: [...previous.folders, ...result.folders], nextPageToken: result.nextPageToken } : result));
    } catch (err) {
      if (request !== listRequest.current) return;
      setListError(errorMessage(err, "Failed to list folders"));
      void loadAccounts();
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }, [browsableAccountId, scope, query, current, loadAccounts]);

  useEffect(() => {
    setListing(null);
    void loadFolders();
  }, [loadFolders]);

  const openFolder = (folder: DriveBrowseFolder) => {
    setPath(query ? [folder] : [...path, folder]);
    setSearch("");
  };

  const changeScope = (next: DriveBrowseScope) => {
    setScope(next);
    setPath([]);
    setSearch("");
  };

  const connect = async () => {
    if (!account || !current) return;
    setConnecting(true);
    try {
      await api.post(`/agents/${agentName}/drive-folders`, { accountId: account.id, folderId: current.id });
      addToast("success", `Connected "${current.name}"`);
      onChanged();
      onClose();
    } catch (err) {
      addToast("error", errorMessage(err, "Failed to connect folder"));
    } finally {
      setConnecting(false);
    }
  };

  const disconnectAccount = async () => {
    if (!account) return;
    setDisconnecting(true);
    try {
      await api.delete(`/google-drive/accounts/${account.id}`);
      addToast("success", `${account.email} disconnected`);
      const list = await loadAccounts();
      const next = list?.find((a) => !a.reauthRequired) ?? list?.[0];
      selectAccount(next?.id ?? "");
      onChanged();
    } catch (err) {
      addToast("error", errorMessage(err, "Failed to disconnect account"));
    } finally {
      setDisconnecting(false);
      setConfirmingDisconnect(false);
    }
  };

  const scopeLabel = SCOPES.find((s) => s.key === scope)?.label ?? "My Drive";

  return (
    <Modal open onClose={onClose} title="Connect Google Drive folder" size="lg" dismissible={!connecting && !disconnecting}>
      <div className="space-y-4">
        {!accountsState && !accountsError && (
          <div role="status" className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        )}
        {accountsError && <p role="alert" className="text-sm text-red-400">{accountsError}</p>}

        {accountsState && !accountsState.configured && (
          <div className="space-y-2 text-sm text-text-secondary">
            <p>Google Drive is not configured on this server.</p>
            {accountsState.redirectUri ? (
              <>
                <p className="text-xs text-text-muted">
                  Create an OAuth client of type <strong>Web application</strong> dedicated to Google Drive (separate from the Second Brain),
                  enable the Google Drive API, add the <span className="font-mono">drive.readonly</span> scope to the consent screen, set
                  GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in Settings and restart the service. Authorized redirect URI:
                </p>
                <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
                  <code className="text-xs text-text-primary font-mono truncate flex-1">{accountsState.redirectUri}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(accountsState.redirectUri ?? "");
                      addToast("success", "Redirect URI copied");
                    }}
                    className="text-text-muted hover:text-accent transition-colors shrink-0"
                    title="Copy" aria-label="Copy redirect URI"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-text-muted">Ask an administrator to enable it.</p>
            )}
          </div>
        )}

        {accountsState?.configured && authorizing && (
          <div role="status" className="flex items-center gap-3 bg-bg border border-border rounded-md px-3 py-3 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin shrink-0" />
            <span className="flex-1">Waiting for Google authorization… finish it in the window that opened.</span>
            <Button size="sm" variant="ghost" onClick={() => setAuthorizing(false)}>Cancel</Button>
          </div>
        )}

        {accountsState?.configured && !authorizing && accounts.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Connect your Google account to choose a folder from your Drive. Claudemar only gets read access.
            </p>
            <Button onClick={startAuthorization}><HardDrive size={14} /> Connect Google account</Button>
          </div>
        )}

        {accountsState?.configured && !authorizing && accounts.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Google account"
                value={accountId}
                onChange={(e) => selectAccount(e.target.value)}
                className="min-w-0 flex-1 bg-surface border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.email}{a.reauthRequired ? " (reconnect required)" : ""}</option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={startAuthorization}><Plus size={13} /> Add account</Button>
              {account && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(true)} title="Disconnect this Google account">
                  <Unplug size={13} /> Disconnect
                </Button>
              )}
            </div>

            {confirmingDisconnect && account && (
              <div role="alert" className="space-y-2 bg-bg border border-red-500/40 rounded-md px-3 py-2">
                <p className="text-sm text-text-secondary">
                  Disconnect <strong className="text-text-primary">{account.email}</strong>?
                  {account.folderCount > 0
                    ? ` ${account.folderCount} folder(s) shared from this account will be removed from every agent.`
                    : " No folders are shared from this account."}
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" disabled={disconnecting} onClick={() => setConfirmingDisconnect(false)}>Cancel</Button>
                  <Button size="sm" variant="danger" disabled={disconnecting} onClick={disconnectAccount}>
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </div>
              </div>
            )}

            {account?.reauthRequired ? (
              <div className="flex items-center gap-2 bg-bg border border-amber-500/40 rounded-md px-3 py-2 text-sm text-text-secondary">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <span className="flex-1">Google access for {account.email} expired or was revoked.</span>
                <Button size="sm" variant="secondary" onClick={startAuthorization}>Reconnect</Button>
              </div>
            ) : account && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Drive location">
                  {SCOPES.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => changeScope(s.key)}
                      aria-pressed={scope === s.key}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer ${scope === s.key ? "border-accent/50 text-accent bg-accent/10" : "border-border text-text-muted hover:text-text-primary"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search folders by name"
                    aria-label="Search folders"
                    className={`${inputClass} pl-8`}
                  />
                </div>

                {!query && (
                  <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
                    <button type="button" onClick={() => setPath([])} className="hover:text-accent cursor-pointer">{scopeLabel}</button>
                    {path.map((crumb, index) => (
                      <span key={crumb.id} className="flex items-center gap-1">
                        <ChevronRight size={12} />
                        <button type="button" onClick={() => setPath(path.slice(0, index + 1))} className="hover:text-accent cursor-pointer truncate max-w-48">
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                )}

                <div className="border border-border rounded-md max-h-72 overflow-y-auto">
                  {listError && <p role="alert" className="px-3 py-2 text-sm text-red-400">{listError}</p>}
                  {!listError && listing && listing.folders.length === 0 && !listLoading && (
                    <p className="px-3 py-2 text-sm text-text-muted">{query ? "No folders match this search." : "No subfolders here."}</p>
                  )}
                  {listing?.folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => openFolder(folder)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover border-b border-border last:border-b-0 cursor-pointer"
                    >
                      {scope === "drives" && !current && !query ? <HardDrive size={14} className="text-text-muted shrink-0" /> : <Folder size={14} className="text-text-muted shrink-0" />}
                      <span className="truncate flex-1">{folder.name}</span>
                      <ChevronRight size={14} className="text-text-muted shrink-0" />
                    </button>
                  ))}
                  {listLoading && (
                    <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Loading folders…</div>
                  )}
                  {!listLoading && listing?.nextPageToken && (
                    <button type="button" onClick={() => void loadFolders(listing.nextPageToken ?? undefined)} className="w-full px-3 py-2 text-xs text-accent hover:underline cursor-pointer">
                      Load more
                    </button>
                  )}
                </div>

                <p className="text-xs text-text-muted">
                  Open the folder you want to share and connect it. Its files are copied into this agent's inputs as a read-only mirror
                  {syncIntervalMinutes > 0 ? `, refreshed every ${syncIntervalMinutes} min` : ", refreshed when you click Sync"}, and are visible
                  to everyone with access to this agent.
                </p>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={onClose} disabled={connecting}>Cancel</Button>
                  <Button size="sm" onClick={connect} disabled={!current || connecting}>
                    {connecting ? "Connecting…" : current ? `Connect "${current.name}"` : "Open a folder to connect"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
