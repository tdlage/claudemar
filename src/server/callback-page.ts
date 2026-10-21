import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { escapeHtml } from "../html.js";

export interface CallbackPage {
  lang: "pt" | "en";
  title: string;
  message: string;
  footer?: string;
  link?: { href: string; label: string };
  script?: string;
}

export function sendCallbackPage(res: Response, status: number, page: CallbackPage): void {
  const nonce = randomBytes(16).toString("base64");
  const scriptSrc = page.script ? `'nonce-${nonce}'` : "'none'";
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src ${scriptSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader("Cache-Control", "no-store");
  const footer = page.footer ? `<p><small>${escapeHtml(page.footer)}</small></p>` : "";
  const link = page.link ? `<p><a href="${escapeHtml(page.link.href)}">${escapeHtml(page.link.label)}</a></p>` : "";
  const script = page.script ? `<script nonce="${nonce}">${page.script}</script>` : "";
  res.status(status).type("html").send(`<!doctype html><html lang="${page.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{text-align:center;max-width:420px;padding:24px}a{color:#8ab4f8}</style>
</head><body><main><h2>${escapeHtml(page.title)}</h2><p>${escapeHtml(page.message)}</p>${footer}${link}</main>${script}</body></html>`);
}
