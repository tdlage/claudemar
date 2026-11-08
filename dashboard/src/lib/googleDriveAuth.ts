import { api } from "./api";
import type { DriveTargetRef } from "./types";

const AUTH_CHANNEL = "claudemar-google-drive";
const AUTH_POPUP = "claudemar-google-drive";

export function driveTargetPath(target: DriveTargetRef): string {
  return `/${target.kind}s/${target.name}`;
}

export interface DriveAuthorizationRequest {
  target: DriveTargetRef;
  write?: boolean;
  accountId?: string;
}

export interface DriveAuthorizationEvent {
  type?: string;
  message?: string;
  accountId?: string;
}

export async function openDriveAuthorization({ target, ...request }: DriveAuthorizationRequest): Promise<"popup" | "redirect"> {
  const popup = window.open("", AUTH_POPUP, "width=520,height=680");
  try {
    const { authUrl } = await api.post<{ authUrl: string }>("/google-drive/accounts/connect", { returnTo: driveTargetPath(target), ...request });
    if (popup && !popup.closed) {
      popup.location.href = authUrl;
      return "popup";
    }
    window.location.assign(authUrl);
    return "redirect";
  } catch (err) {
    popup?.close();
    throw err;
  }
}

export function listenDriveAuthorization(handler: (event: DriveAuthorizationEvent) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.addEventListener("message", (event: MessageEvent<DriveAuthorizationEvent>) => handler(event.data ?? {}));
  return () => channel.close();
}
