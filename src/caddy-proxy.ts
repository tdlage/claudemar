import { execFile } from "node:child_process";
import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunConfig } from "./run-process-manager.js";

const PROXY_FILE = process.env.CADDY_PROXY_FILE || "/etc/caddy/conf.d/claudemar-proxies";
const RELOAD_CMD = process.env.CADDY_RELOAD_CMD || "systemctl reload caddy";

function generateCaddyfile(configs: RunConfig[]): string {
  const proxies = configs.filter((c) => c.proxyDomain && c.proxyPort);
  if (proxies.length === 0) return "";

  const blocks = proxies.map((c) =>
    `${c.proxyDomain} {\n\treverse_proxy localhost:${c.proxyPort}\n}`
  );
  return blocks.join("\n\n") + "\n";
}

function reloadCaddy(): void {
  const [cmd, ...args] = RELOAD_CMD.split(" ");
  execFile(cmd, args, (err) => {
    if (err) {
      console.error("[caddy-proxy] reload failed:", err.message);
    } else {
      console.log("[caddy-proxy] Caddy reloaded successfully");
    }
  });
}

export function syncCaddyProxy(configs: RunConfig[]): void {
  const content = generateCaddyfile(configs);
  const existing = existsSync(PROXY_FILE)
    ? readFileSync(PROXY_FILE, "utf-8")
    : "";

  if (content === existing) return;

  const dir = dirname(PROXY_FILE);
  mkdirSync(dir, { recursive: true });

  const tmp = PROXY_FILE + ".tmp";
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, PROXY_FILE);
    console.log(`[caddy-proxy] Updated ${PROXY_FILE}`);
    reloadCaddy();
  } catch (err) {
    console.error("[caddy-proxy] write failed:", err);
  }
}
