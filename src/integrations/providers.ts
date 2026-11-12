import { config } from "../config.js";

export const INTEGRATION_PROVIDERS = ["asana", "notion"] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === "string" && (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export interface AccountIdentity {
  externalId: string;
  name: string;
  detail: string;
}

export type ClientRegistration =
  | { kind: "static"; clientIdEnv: string; clientSecretEnv: string; clientId: () => string; clientSecret: () => string }
  | { kind: "dynamic" };

export interface ProviderSpec {
  id: IntegrationProvider;
  label: string;
  mcpUrl: string;
  // Recurso RFC 8707 pedido na autorização; null usa o publicado no protected resource metadata.
  resource: string | null;
  requestScopes: boolean;
  extraAuthorizationParams: Record<string, string>;
  registration: ClientRegistration;
  identity(tokenResponse: Record<string, unknown>): AccountIdentity | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const PROVIDERS: Record<IntegrationProvider, ProviderSpec> = {
  asana: {
    id: "asana",
    label: "Asana",
    mcpUrl: "https://mcp.asana.com/v2/mcp",
    resource: "https://mcp.asana.com/v2",
    requestScopes: false,
    extraAuthorizationParams: {},
    registration: {
      kind: "static",
      clientIdEnv: "ASANA_CLIENT_ID",
      clientSecretEnv: "ASANA_CLIENT_SECRET",
      clientId: () => config.asanaClientId,
      clientSecret: () => config.asanaClientSecret,
    },
    identity(tokenResponse) {
      const user = record(tokenResponse.data);
      const gid = text(user.gid) || text(user.id);
      if (!gid) return null;
      const email = text(user.email);
      return { externalId: gid, name: text(user.name) || email || "Asana", detail: email };
    },
  },
  notion: {
    id: "notion",
    label: "Notion",
    mcpUrl: "https://mcp.notion.com/mcp",
    resource: null,
    requestScopes: true,
    extraAuthorizationParams: { prompt: "consent" },
    registration: { kind: "dynamic" },
    identity(tokenResponse) {
      const workspaceId = text(tokenResponse.workspace_id);
      if (!workspaceId) return null;
      const userId = text(tokenResponse.user_id);
      const domain = text(tokenResponse.email_domain);
      return {
        externalId: userId ? `${workspaceId}:${userId}` : workspaceId,
        name: text(tokenResponse.workspace_name) || "Notion",
        detail: domain ? `@${domain}` : "",
      };
    },
  },
};

export function providerConfigured(spec: ProviderSpec): boolean {
  return spec.registration.kind === "dynamic" || Boolean(spec.registration.clientId() && spec.registration.clientSecret());
}

export const INTEGRATIONS_API_PATH = "/api/integrations";

export function callbackPath(provider: IntegrationProvider): string {
  return `${INTEGRATIONS_API_PATH}/${provider}/callback`;
}

export function callbackUri(provider: IntegrationProvider): string {
  const base = config.publicBaseUrl || `http://localhost:${config.dashboardPort}`;
  return `${base.replace(/\/$/, "")}${callbackPath(provider)}`;
}
