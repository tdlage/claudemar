import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

interface Registration {
  servers: Record<string, McpServer>;
  transports: Map<string, StreamableHTTPServerTransport>;
}

// Expõe os servidores MCP in-process (memory, brain, scheduler, pipeline) ao processo do
// Codex CLI por Streamable HTTP em loopback. Cada sessão registra seus servidores sob um
// bearer token próprio; cada turno do Codex é um processo novo (um cliente MCP por servidor),
// então os transportes são recriados a cada turno.
class McpHttpHost {
  private server: Server | null = null;
  private port = 0;
  private starting: Promise<number> | null = null;
  private registrations = new Map<string, Registration>();

  private ensureStarted(): Promise<number> {
    if (this.port > 0) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    this.starting = new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
    return this.starting;
  }

  register(servers: Record<string, McpServer>): string {
    const token = randomUUID();
    this.registrations.set(token, { servers, transports: new Map() });
    return token;
  }

  async bindTurn(token: string): Promise<Record<string, string>> {
    const registration = this.registrations.get(token);
    if (!registration) throw new Error("Registro MCP inexistente para esta sessão.");
    const port = await this.ensureStarted();
    const urls: Record<string, string> = {};
    for (const [name, server] of Object.entries(registration.servers)) {
      const previous = registration.transports.get(name);
      if (previous) await previous.close().catch(() => {});
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      await server.connect(transport);
      registration.transports.set(name, transport);
      urls[name] = `http://127.0.0.1:${port}/${encodeURIComponent(name)}`;
    }
    return urls;
  }

  async unregister(token: string): Promise<void> {
    const registration = this.registrations.get(token);
    if (!registration) return;
    this.registrations.delete(token);
    for (const transport of registration.transports.values()) {
      await transport.close().catch(() => {});
    }
    for (const server of Object.values(registration.servers)) {
      await server.close().catch(() => {});
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
    const registration = token ? this.registrations.get(token) : undefined;
    if (!registration) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const name = decodeURIComponent((req.url ?? "/").split("?")[0].replace(/^\/+/, ""));
    const transport = registration.transports.get(name);
    if (!transport) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown mcp server" }));
      return;
    }
    await transport.handleRequest(req, res);
  }
}

export const mcpHttpHost = new McpHttpHost();
