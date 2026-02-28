import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { RunConfig } from "./run-process-manager.js";

const PROXY_FILE = process.env.NGINX_PROXY_FILE || "/etc/nginx/conf.d/claudemar-proxies.conf";
const SSL_CERT = process.env.NGINX_SSL_CERT || "/etc/letsencrypt/live/claudemar.com.br/fullchain.pem";
const SSL_KEY = process.env.NGINX_SSL_KEY || "/etc/letsencrypt/live/claudemar.com.br/privkey.pem";

function generateNginxConfig(configs: RunConfig[]): string {
  const proxies = configs.filter((c) => c.proxyDomain && c.proxyPort);
  if (proxies.length === 0) return "";

  const blocks = proxies.map((c) => {
    const httpBlock = [
      `server {`,
      `\tlisten 80;`,
      `\tlisten [::]:80;`,
      `\tserver_name ${c.proxyDomain};`,
      ``,
      `\tlocation / {`,
      `\t\treturn 301 https://$host$request_uri;`,
      `\t}`,
      `}`,
    ].join("\n");

    const httpsBlock = [
      `server {`,
      `\tlisten 443 ssl http2;`,
      `\tlisten [::]:443 ssl http2;`,
      `\tserver_name ${c.proxyDomain};`,
      ``,
      `\tssl_certificate ${SSL_CERT};`,
      `\tssl_certificate_key ${SSL_KEY};`,
      `\tssl_protocols TLSv1.2 TLSv1.3;`,
      ``,
      `\tlocation / {`,
      `\t\tproxy_pass http://localhost:${c.proxyPort};`,
      `\t\tproxy_set_header Host $host;`,
      `\t\tproxy_set_header X-Real-IP $remote_addr;`,
      `\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `\t\tproxy_set_header X-Forwarded-Proto $scheme;`,
      `\t\tproxy_http_version 1.1;`,
      `\t\tproxy_set_header Upgrade $http_upgrade;`,
      `\t\tproxy_set_header Connection "upgrade";`,
      `\t}`,
      `}`,
    ].join("\n");

    return `${httpBlock}\n\n${httpsBlock}`;
  });

  return blocks.join("\n\n") + "\n";
}

function sudoWrite(filePath: string, content: string): void {
  execFileSync("sudo", ["tee", filePath], {
    input: content,
    stdio: ["pipe", "ignore", "pipe"],
    timeout: 10_000,
  });
}

function reloadNginx(): void {
  execFile("sudo", ["systemctl", "reload", "nginx"], (err) => {
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

  try {
    sudoWrite(PROXY_FILE, content);
    console.log(`[nginx-proxy] Updated ${PROXY_FILE}`);
    reloadNginx();
  } catch (err) {
    console.error("[nginx-proxy] write failed:", err);
  }
}
