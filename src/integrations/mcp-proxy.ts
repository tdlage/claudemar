import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ToolListChangedNotificationSchema,
  type CallToolRequest,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { accessToken, ReauthRequiredError } from "./oauth.js";
import { PROVIDERS, type ProviderSpec } from "./providers.js";
import { integrationStore, type AgentIntegrationLink } from "./store.js";

const TOOL_TIMEOUT_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;
const SESSION_NOT_FOUND = 404;

function authorizedFetch(accountId: string): FetchLike {
  return async (url, init) => {
    const send = (token: string) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    };
    const token = await accessToken(accountId);
    const response = await send(token);
    if (response.status !== 401) return response;
    await response.body?.cancel().catch(() => {});
    return send(await accessToken(accountId, token));
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Conexão com o servidor MCP oficial do provedor, aberta sob demanda e fechada quando ociosa.
// O token é obtido a cada requisição, então sessões longas sobrevivem à expiração do access token.
class RemoteMcpConnection {
  private client: Promise<Client> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly spec: ProviderSpec,
    private readonly accountId: string,
    private readonly onToolsChanged: () => void,
  ) {}

  async listTools(): Promise<Tool[]> {
    return this.run(async (client) => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: LIST_TIMEOUT_MS });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    });
  }

  async callTool(params: CallToolRequest["params"], signal: AbortSignal): Promise<CallToolResult> {
    return this.run((client) => client.callTool(params, undefined, { signal, timeout: TOOL_TIMEOUT_MS }) as Promise<CallToolResult>);
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const pending = this.client;
    this.client = null;
    if (!pending) return;
    const client = await pending.catch(() => null);
    await client?.close().catch(() => {});
  }

  private connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "claudemar", version: "1.0.0" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.onToolsChanged());
    const transport = new StreamableHTTPClientTransport(new URL(this.spec.mcpUrl), { fetch: authorizedFetch(this.accountId) });
    const connecting = client.connect(transport).then(() => client);
    this.client = connecting;
    connecting.catch(() => {
      if (this.client === connecting) this.client = null;
    });
    return connecting;
  }

  private async run<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      try {
        return await operation(await this.connect());
      } catch (err) {
        if (!(err instanceof StreamableHTTPError && err.code === SESSION_NOT_FOUND)) throw err;
        await this.close();
        return await operation(await this.connect());
      }
    } finally {
      this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
      this.idleTimer.unref();
    }
  }
}

function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Servidor MCP in-process que repassa tools/list e tools/call ao servidor oficial do provedor com a
// conta vinculada ao agente; funciona igual nos dois runtimes e o token nunca sai deste processo.
function createProxyServer(link: AgentIntegrationLink): McpSdkServerConfigWithInstance {
  const spec = PROVIDERS[link.provider];
  const server = new McpServer({ name: spec.id, version: "1.0.0" }, { capabilities: { tools: { listChanged: true } } });
  const remote = new RemoteMcpConnection(spec, link.accountId, () => {
    if (server.isConnected()) server.sendToolListChanged();
  });
  const stillLinked = () => integrationStore.linkOf(link.agentName, link.provider)?.accountId === link.accountId;

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!stillLinked()) return { tools: [] };
    try {
      return { tools: await remote.listTools() };
    } catch (err) {
      throw new McpError(ErrorCode.InternalError, `${spec.label}: ${errorMessage(err)}`);
    }
  });

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!stillLinked()) return failure(`${spec.label} is no longer connected to this agent.`);
    try {
      return await remote.callTool(request.params, extra.signal);
    } catch (err) {
      if (err instanceof ReauthRequiredError) return failure(err.message);
      return failure(`${spec.label} request failed: ${errorMessage(err)}`);
    }
  });

  server.server.onclose = () => void remote.close();
  return { type: "sdk", name: spec.id, instance: server };
}

function usableLinks(agentName: string): AgentIntegrationLink[] {
  return integrationStore.linksOf(agentName).filter((link) => {
    const account = integrationStore.getAccount(link.accountId);
    return account !== undefined && !account.reauthRequired;
  });
}

export function integrationMcpServers(agentName: string): Record<string, McpSdkServerConfigWithInstance> {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const link of usableLinks(agentName)) servers[link.provider] = createProxyServer(link);
  return servers;
}
