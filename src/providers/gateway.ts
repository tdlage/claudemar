import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connect } from "node:net";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

// O gateway Bifrost roda como container Docker (serviço `bifrost` no docker-compose.yml,
// container_name `claudemar-bifrost`). O bot roda no host via systemd e o usuário pertence
// ao grupo `docker`, então gerenciamos o ciclo de vida direto por `docker compose`, sem SSH.
const COMPOSE_SERVICE = "bifrost";
const CONTAINER_NAME = "claudemar-bifrost";
const WATCHDOG_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3000;
const COMPOSE_TIMEOUT_MS = 120_000;

export interface GatewayStatus {
  enabled: boolean;
  containerRunning: boolean;
  reachable: boolean;
  url: string;
  lastError: string;
  lastCheckedAt: string;
}

function parseEndpoint(url: string): { host: string; port: number } {
  try {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { host: u.hostname, port };
  } catch {
    return { host: "localhost", port: 8080 };
  }
}

class GatewayManager {
  private endpoint = parseEndpoint(config.gatewayUrl);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ensuring = false;
  private status: GatewayStatus = {
    enabled: false,
    containerRunning: false,
    reachable: false,
    url: config.gatewayUrl,
    lastError: "",
    lastCheckedAt: "",
  };

  async start(): Promise<void> {
    this.status.enabled = true;
    await this.ensureUp();
    await this.refresh();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), WATCHDOG_INTERVAL_MS);
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.enabled = false;
  }

  private async tick(): Promise<void> {
    await this.refresh();
    if (!this.status.reachable) {
      console.warn("[gateway] Bifrost inacessível — reerguendo container");
      await this.ensureUp();
      await this.refresh();
    }
  }

  async ensureUp(): Promise<void> {
    if (this.ensuring) return;
    this.ensuring = true;
    try {
      await execFileAsync("docker", ["compose", "up", "-d", COMPOSE_SERVICE], {
        cwd: config.installDir,
        timeout: COMPOSE_TIMEOUT_MS,
      });
      this.status.lastError = "";
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      console.error("[gateway] Falha ao subir o Bifrost:", this.status.lastError);
    } finally {
      this.ensuring = false;
    }
  }

  async restart(): Promise<GatewayStatus> {
    try {
      await execFileAsync("docker", ["compose", "restart", COMPOSE_SERVICE], {
        cwd: config.installDir,
        timeout: COMPOSE_TIMEOUT_MS,
      });
      this.status.lastError = "";
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      await this.ensureUp();
    }
    return this.refresh();
  }

  async refresh(): Promise<GatewayStatus> {
    this.status.containerRunning = await this.isContainerRunning();
    this.status.reachable = await this.isReachable();
    this.status.lastCheckedAt = new Date().toISOString();
    return this.getStatus();
  }

  getStatus(): GatewayStatus {
    return { ...this.status };
  }

  private async isContainerRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME],
        { timeout: 5000 },
      );
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  private isReachable(): Promise<boolean> {
    return new Promise((resolveReachable) => {
      const socket = connect({ host: this.endpoint.host, port: this.endpoint.port });
      const finish = (ok: boolean): void => {
        socket.destroy();
        resolveReachable(ok);
      };
      socket.setTimeout(HEALTH_TIMEOUT_MS);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }
}

export const gatewayManager = new GatewayManager();
