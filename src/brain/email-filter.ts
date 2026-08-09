export const GMAIL_CATEGORIES = ["promotions", "social", "updates", "forums"] as const;
export type GmailCategory = (typeof GMAIL_CATEGORIES)[number];

const CATEGORY_LABELS: Record<GmailCategory, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

const ALWAYS_SKIP_LABELS = new Set(["SPAM", "TRASH"]);

export function buildCategoryQuery(skipCategories: string[]): string {
  return skipCategories
    .filter((c): c is GmailCategory => (GMAIL_CATEGORIES as readonly string[]).includes(c))
    .map((c) => `-category:${c}`)
    .join(" ");
}

export function skippedByLabels(labelIds: string[] | undefined, skipCategories: string[]): string | null {
  if (!labelIds) return null;
  for (const label of labelIds) {
    if (ALWAYS_SKIP_LABELS.has(label)) return label.toLowerCase();
  }
  for (const category of skipCategories) {
    const label = CATEGORY_LABELS[category as GmailCategory];
    if (label && labelIds.includes(label)) return category;
  }
  return null;
}

export function matchesBlockedSender(handle: string, blocked: string[]): boolean {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return false;
  const domain = normalized.split("@")[1] ?? "";
  for (const entry of blocked) {
    const rule = entry.trim().toLowerCase();
    if (!rule) continue;
    if (rule.includes("@")) {
      if (normalized === rule) return true;
    } else if (domain === rule || domain.endsWith(`.${rule}`)) {
      return true;
    }
  }
  return false;
}

export interface BulkSignals {
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
  listId?: string;
  fromHandle?: string;
}

const NOREPLY_RE = /^(no[-._]?reply|do[-._]?not[-._]?reply|newsletter|news|mailer|notifications?|marketing|promo(coes|tions)?|info)@/i;

export function detectBulk(signals: BulkSignals): string | null {
  if (signals.listUnsubscribe) return "list-unsubscribe";
  if (signals.listId) return "list-id";
  if (signals.precedence && /^(bulk|list|junk)$/i.test(signals.precedence.trim())) return "precedence";
  if (signals.autoSubmitted && !/^no$/i.test(signals.autoSubmitted.trim())) return "auto-submitted";
  if (signals.fromHandle && NOREPLY_RE.test(signals.fromHandle.trim())) return "noreply-sender";
  return null;
}
