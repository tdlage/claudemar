import { existsSync } from "node:fs";
import { agentSecretsManager, projectSecretsManager } from "../secrets-manager.js";
import { isEmailEnabled, getEmailScriptPath } from "../email-init.js";
import { settingsManager } from "../settings-manager.js";
import { emailSettingsManager } from "../email-settings-manager.js";

export function buildSecretsHint(agentName: string): string {
  const secretsJsonPath = agentSecretsManager.secretsJsonPath(agentName);
  if (!existsSync(secretsJsonPath)) return "";
  return `\n[SYSTEM: You have secrets configured. Read ${secretsJsonPath} for credentials, API keys, and secret file paths.]`;
}

export function buildProjectSecretsHint(projectName: string): string {
  const secretsJsonPath = projectSecretsManager.secretsJsonPath(projectName);
  if (!existsSync(secretsJsonPath)) return "";
  return `\n[SYSTEM: This project has secrets configured. Read ${secretsJsonPath} for credentials, API keys, and secret file paths. You are authorized to read this file and the secret files it lists, even though they are outside your working directory. Never write their values into the repository.]`;
}

export function buildEmailHint(): string {
  if (!isEmailEnabled()) return "";
  const scriptPath = getEmailScriptPath();
  const { sesFrom } = settingsManager.get();
  const defaultFrom = sesFrom ? ` Default sender: ${sesFrom}.` : "";
  const senderList = emailSettingsManager.getProfiles().map((p) => p.from).join(", ");
  const availableSenders = senderList ? ` Available senders: ${senderList}.` : "";
  return `\n[SYSTEM: You can send emails. Usage: ${scriptPath} --to <email> --subject "<subject>" --body "<body>" [--from <sender-email>] [--html] [--cc <email>] [--attachment <filepath> ...]. Multiple --attachment flags supported.${defaultFrom}${availableSenders}]`;
}
