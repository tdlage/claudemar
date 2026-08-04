import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { config } from "../config.js";
import { tokenManager } from "./token-manager.js";

interface AdminPasskey {
  id: string;
  publicKey: string; // base64url
  counter: number;
  transports: AuthenticatorTransportFuture[];
  createdAt: string;
  name: string;
}

interface PasskeyStore {
  credentials: AdminPasskey[];
}

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

class PasskeyManager {
  private credentials: AdminPasskey[] = [];
  private challenges = new Map<string, PendingChallenge>();
  private storePath: string;

  constructor() {
    this.storePath = resolve(config.dataPath, "admin-passkeys.json");
    this.load();
    setInterval(() => this.expireChallenges(), 60_000);
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      this.credentials = [];
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.storePath, "utf-8")) as PasskeyStore;
      this.credentials = raw.credentials ?? [];
    } catch {
      this.credentials = [];
    }
  }

  private save(): void {
    const store: PasskeyStore = { credentials: this.credentials };
    writeFileSync(this.storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  private setChallenge(key: string, challenge: string): void {
    this.challenges.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  private takeChallenge(key: string): string | null {
    const pending = this.challenges.get(key);
    if (!pending) return null;
    this.challenges.delete(key);
    if (Date.now() > pending.expiresAt) return null;
    return pending.challenge;
  }

  private expireChallenges(): void {
    const now = Date.now();
    for (const [key, pending] of this.challenges) {
      if (now > pending.expiresAt) this.challenges.delete(key);
    }
  }

  private resolveHost(host?: string): string {
    if (config.webAuthnRpId) return config.webAuthnRpId;
    if (!host) return "localhost";
    return host.split(":")[0];
  }

  private resolveOrigin(host?: string): string {
    const configured = config.publicBaseUrl.replace(/\/$/, "");
    if (configured) return configured;
    if (!host) return `http://localhost:${config.dashboardPort}`;
    const isLocal = host.startsWith("localhost") || host.startsWith("127.");
    const protocol = isLocal ? "http" : "https";
    return `${protocol}://${host}`;
  }

  hasCredentials(): boolean {
    return this.credentials.length > 0;
  }

  getCredentials(): AdminPasskey[] {
    return [...this.credentials];
  }

  async generateRegistrationOptions(name: string, host?: string): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challenge: string; rpId: string; origin: string }> {
    const rpId = this.resolveHost(host);
    const options = await generateRegistrationOptions({
      rpName: config.webAuthnRpName,
      rpID: rpId,
      userName: "admin",
      userDisplayName: "Administrator",
      attestationType: "none",
      excludeCredentials: this.credentials.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
    });

    this.setChallenge(options.challenge, options.challenge);
    return { options, challenge: options.challenge, rpId, origin: this.resolveOrigin(host) };
  }

  async verifyRegistration(name: string, challenge: string, response: RegistrationResponseJSON, host?: string): Promise<AdminPasskey> {
    const expectedChallenge = this.takeChallenge(challenge);
    if (!expectedChallenge) {
      throw new Error("Challenge inválido ou expirado.");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.resolveOrigin(host),
      expectedRPID: this.resolveHost(host),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Falha na verificação do passkey.");
    }

    const info = verification.registrationInfo;
    const credential = info.credential;
    const passkey: AdminPasskey = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? (info.credentialDeviceType === "multiDevice" ? ["hybrid", "internal"] : ["internal"]),
      createdAt: new Date().toISOString(),
      name: name || `Passkey ${this.credentials.length + 1}`,
    };

    this.credentials.push(passkey);
    this.save();
    return passkey;
  }

  async generateAuthenticationOptions(host?: string): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challenge: string; rpId: string; origin: string }> {
    const rpId = this.resolveHost(host);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: this.credentials.map((c) => ({ id: c.id, transports: c.transports })),
      userVerification: "preferred",
    });

    this.setChallenge(options.challenge, options.challenge);
    return { options, challenge: options.challenge, rpId, origin: this.resolveOrigin(host) };
  }

  async verifyAuthentication(challenge: string, response: AuthenticationResponseJSON, host?: string): Promise<{ verified: boolean; token: string }> {
    const credential = this.credentials.find((c) => c.id === response.id);
    if (!credential) {
      throw new Error("Credencial não encontrada.");
    }

    const expectedChallenge = this.takeChallenge(challenge);
    if (!expectedChallenge) {
      throw new Error("Challenge inválido ou expirado.");
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.resolveOrigin(host),
      expectedRPID: this.resolveHost(host),
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: credential.counter,
        transports: credential.transports,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      throw new Error("Falha na autenticação com passkey.");
    }

    credential.counter = verification.authenticationInfo.newCounter;
    this.save();

    return { verified: true, token: tokenManager.getCurrentToken() };
  }

  deleteCredential(id: string): boolean {
    const before = this.credentials.length;
    this.credentials = this.credentials.filter((c) => c.id !== id);
    if (this.credentials.length < before) {
      this.save();
      return true;
    }
    return false;
  }
}

export const passkeyManager = new PasskeyManager();
export type { AdminPasskey };
