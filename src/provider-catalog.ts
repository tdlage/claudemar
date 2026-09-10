import { settingsManager } from "./settings-manager.js";
import { getClaudeAuthStatus } from "./claude/oauth-login.js";
import { getCodexAuthStatus } from "./codex/auth.js";
import { parseExtraEnv, type LlmProfile } from "./providers/llm.js";
import { modelsForProfiles, resolveModelSelection } from "./model-routing.js";

let nativeStatus = { claude: false, codex: false };

export function profileConfigured(profile: LlmProfile): boolean {
  const env = { ...process.env, ...Object.fromEntries(parseExtraEnv(profile.extraEnv)) };
  if (profile.baseUrl.trim()) return Boolean(profile.tokenEnv.trim() && env[profile.tokenEnv.trim()]?.trim());
  if (profile.runtime === "claude") return nativeStatus.claude || Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim() || env.CLAUDE_CODE_OAUTH_TOKEN?.trim());
  return nativeStatus.codex;
}

export function availableProfiles(): LlmProfile[] {
  return settingsManager.get().llmProfiles.filter(profileConfigured);
}

export async function refreshProviderCatalog() {
  const claude = getClaudeAuthStatus();
  const codex = await getCodexAuthStatus().catch(() => ({ loggedIn: false, method: "none" }));
  nativeStatus = { claude: claude.present && (!claude.expired || Boolean(claude.canRefresh)), codex: codex.loggedIn && codex.method === "chatgpt" };
  return modelsForProfiles(availableProfiles());
}

export function resolveAvailableModel(selection?: string) {
  const profiles = availableProfiles();
  if (!profiles.length) throw new Error("Nenhum provider autenticado. Configure uma conta ou chave em Settings.");
  return resolveModelSelection(selection || modelsForProfiles(profiles)[0]?.model || "", profiles);
}
