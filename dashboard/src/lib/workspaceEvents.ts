export type WorkspaceKind = "projects" | "agents";
export const CREATE_WORKSPACE_EVENT = "claudemar:create-workspace";
export const WORKSPACES_CHANGED_EVENT = "claudemar:workspaces-changed";
export const AGENT_FAVORITES_CHANGED_EVENT = "claudemar:agent-favorites-changed";
export const OPEN_SEARCH_EVENT = "claudemar:open-search";

export function openCreateWorkspace(kind: WorkspaceKind) {
  window.dispatchEvent(
    new CustomEvent(CREATE_WORKSPACE_EVENT, { detail: kind }),
  );
}
