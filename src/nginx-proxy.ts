import { execFile } from "node:child_process";
import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunConfig } from "./run-process-manager.js";

const PROXY_FILE = process.env.NGINX_PROXY_FILE || "/etc/nginx/conf.d/claudemar-proxies.conf";
const RELOAD_CMD = process.env.NGINX_RELOAD_CMD || "systemctl reload nginx";

function generateNginxConfig(configs: RunConfig[]): string {
  const proxies = configs.filter((c) => c.proxyDomain && c.proxyPort);
  if (proxies.length === 0) return "";

  const blocks = proxies.map((c) =>
    `server {\n\tlisten 80;\n\tserver_name ${c.proxyDomain};\n\n\tlocation / {\n\t\tproxy_pass http://localhost:${c.proxyPort};\n\t\tproxy_set_header Host $host;\n\t\tproxy_set_header X-Real-IP $remote_addr;\n\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\t\tproxy_set_header X-Forwarded-Proto $scheme;\n\t\tproxy_http_version 1.1;\n\t\tproxy_set_header Upgrade $http_upgrade;\n\t\tproxy_set_header Connection "upgrade";\n\t}\n}`
  );
  return blocks.join("\n\n") + "\n";
}

function reloadNginx(): void {
  const [cmd, ...args] = RELOAD_CMD.split(" ");
  execFile(cmd, args, (err) => {
    if (err) {
      console.error("[nginx-proxy] reload failed:", err.message);
    } else {
      console.log("[nginx-proxy] nginx reloaded successfully");
    }
  });
}

export function syncNginxProxy(configs: RunConfig[]): void {
  const content = generateNginxConfig(configs);
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
    console.log(`[nginx-proxy] Updated ${PROXY_FILE}`);
    reloadNginx();
  } catch (err) {
    console.error("[nginx-proxy] write failed:", err);
  }
}
