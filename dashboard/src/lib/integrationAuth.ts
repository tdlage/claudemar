import { api } from "./api";
import type { IntegrationProviderId } from "./types";

const AUTH_CHANNEL = "claudemar-integrations";
const AUTH_POPUP = "claudemar-integrations";

export interface IntegrationAuthorizationEvent {
  type?: string;
  message?: string;
}

export async function openIntegrationAuthorization(agentName: string, provider: IntegrationProviderId, accountId?: string): Promise<"popup" | "redirect"> {
  const popup = window.open("", AUTH_POPUP, "width=560,height=720");
  try {
    const { authUrl } = await api.post<{ authUrl: string }>(`/agents/${agentName}/integrations/connect`, { provider, accountId });
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

export function listenIntegrationAuthorization(handler: (event: IntegrationAuthorizationEvent) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.addEventListener("message", (event: MessageEvent<IntegrationAuthorizationEvent>) => handler(event.data ?? {}));
  return () => channel.close();
}
