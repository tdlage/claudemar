import { absoluteSignedUrl, PR_EVIDENCE_TTL_SECONDS } from "./upload-signer.js";

export const EVIDENCE_START = "<!-- e2e-evidence:start -->";
export const EVIDENCE_END = "<!-- e2e-evidence:end -->";
export const MAX_EVIDENCE_IMAGES = 20;

export interface EvidenceImage {
  name: string;
  url: string;
}

export function buildEvidenceImageUrls(screenshots: string[], baseUrl: string): EvidenceImage[] {
  if (!baseUrl) return [];
  return screenshots
    .filter((name) => name.length > 0)
    .map((name) => ({ name, url: absoluteSignedUrl(name, baseUrl, PR_EVIDENCE_TTL_SECONDS) }));
}

export function buildE2eEvidenceSection(images: EvidenceImage[]): string {
  if (images.length === 0) return "";
  const shown = images.slice(0, MAX_EVIDENCE_IMAGES);
  const lines = shown.map((img) => `![${img.name}](${img.url})`);
  if (images.length > shown.length) {
    const rest = images.slice(MAX_EVIDENCE_IMAGES);
    lines.push("", ...rest.map((img) => `- [${img.name}](${img.url})`));
  }
  return [EVIDENCE_START, "## Evidências E2E", "", ...lines, EVIDENCE_END].join("\n");
}

export function upsertEvidenceSection(body: string, section: string): string {
  const base = body ?? "";
  const start = base.indexOf(EVIDENCE_START);
  const end = base.indexOf(EVIDENCE_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = base.slice(0, start).replace(/\s+$/, "");
    const after = base.slice(end + EVIDENCE_END.length).replace(/^\s+/, "");
    if (!section) {
      return [before, after].filter((part) => part.length > 0).join("\n\n");
    }
    return [before, section, after].filter((part) => part.length > 0).join("\n\n");
  }

  if (!section) return base;
  return base.length > 0 ? `${base.replace(/\s+$/, "")}\n\n${section}` : section;
}
