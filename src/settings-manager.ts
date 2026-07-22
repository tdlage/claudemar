import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
import {
  DEFAULT_ACTIVE_PROFILE_ID,
  defaultLlmProfiles,
  sanitizeProfile,
  seedMissingDefaultProfiles,
  type LlmProfile,
} from "./providers/llm.js";

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
  llmProfiles: LlmProfile[];
  activeProfileId: string;
}

function defaults(): RuntimeSettings {
  return {
    sesFrom: config.sesFrom,
    adminEmail: config.adminEmail,
    llmProfiles: defaultLlmProfiles(),
    activeProfileId: DEFAULT_ACTIVE_PROFILE_ID,
  };
}

function defaultSeededIds(): string[] {
  return defaultLlmProfiles().map((p) => p.id);
}

function sanitizeProfiles(raw: unknown): LlmProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const profiles: LlmProfile[] = [];
  raw.forEach((entry, idx) => {
    const profile = sanitizeProfile(entry, `profile-${idx + 1}`);
    if (!profile || seen.has(profile.id)) return;
    seen.add(profile.id);
    profiles.push(profile);
  });
  return profiles;
}

class SettingsManager {
  private data: RuntimeSettings = defaults();
  private seededProfileIds: string[] = defaultSeededIds();
  private persister = new JsonPersister(resolve(config.dataPath, "settings.json"), "settings");

  constructor() {
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const raw = this.persister.readSync() as Record<string, unknown> | null;
    if (!raw) return;
    if (typeof raw.sesFrom === "string") this.data.sesFrom = raw.sesFrom;
    if (typeof raw.adminEmail === "string") this.data.adminEmail = raw.adminEmail;

    if (Array.isArray(raw.llmProfiles)) {
      const profiles = sanitizeProfiles(raw.llmProfiles);
      if (profiles.length > 0) {
        const persistedSeededIds = Array.isArray(raw.seededProfileIds)
          ? raw.seededProfileIds.filter((id): id is string => typeof id === "string")
          : [];
        const seeded = seedMissingDefaultProfiles(profiles, persistedSeededIds);
        this.data.llmProfiles = seeded.profiles;
        this.seededProfileIds = seeded.seededIds;
        if (seeded.changed) this.persister.scheduleWrite(() => this.serialize());
      }
      const active = typeof raw.activeProfileId === "string" ? raw.activeProfileId : "";
      this.data.activeProfileId = this.resolveActiveId(active);
      return;
    }

    // Migração do formato antigo ({ llmProvider: "anthropic" | "zai", zaiModel }): mantém
    // os perfis padrão e apenas seleciona o equivalente.
    if (raw.llmProvider === "anthropic" || raw.llmProvider === "zai") {
      this.data.activeProfileId = this.resolveActiveId(raw.llmProvider);
    }
  }

  private resolveActiveId(candidate: string): string {
    if (candidate && this.data.llmProfiles.some((p) => p.id === candidate)) return candidate;
    if (this.data.llmProfiles.some((p) => p.id === DEFAULT_ACTIVE_PROFILE_ID)) return DEFAULT_ACTIVE_PROFILE_ID;
    return this.data.llmProfiles[0]?.id ?? DEFAULT_ACTIVE_PROFILE_ID;
  }

  private serialize(): RuntimeSettings & { seededProfileIds: string[] } {
    return { ...this.data, seededProfileIds: this.seededProfileIds };
  }

  reload(): void {
    this.data = defaults();
    this.seededProfileIds = defaultSeededIds();
    this.applyFromDisk();
  }

  get(): RuntimeSettings {
    return {
      sesFrom: this.data.sesFrom,
      adminEmail: this.data.adminEmail,
      llmProfiles: this.data.llmProfiles.map((p) => ({ ...p })),
      activeProfileId: this.data.activeProfileId,
    };
  }

  getActiveProfile(): LlmProfile {
    return (
      this.data.llmProfiles.find((p) => p.id === this.data.activeProfileId) ??
      this.data.llmProfiles[0] ??
      defaultLlmProfiles()[0]
    );
  }

  update(patch: Partial<RuntimeSettings>): void {
    if (patch.sesFrom !== undefined) this.data.sesFrom = patch.sesFrom;
    if (patch.adminEmail !== undefined) this.data.adminEmail = patch.adminEmail;
    if (patch.llmProfiles !== undefined) {
      const profiles = sanitizeProfiles(patch.llmProfiles);
      if (profiles.length > 0) {
        this.data.llmProfiles = profiles;
        this.data.activeProfileId = this.resolveActiveId(this.data.activeProfileId);
      }
    }
    if (patch.activeProfileId !== undefined) {
      this.data.activeProfileId = this.resolveActiveId(patch.activeProfileId);
    }
    this.persister.scheduleWrite(() => this.serialize());
  }

  flush(): void {
    this.persister.flushSync(this.serialize());
  }
}

export const settingsManager = new SettingsManager();
