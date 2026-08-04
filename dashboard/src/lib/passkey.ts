import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "./api";

export function isPasskeySupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function registerPasskey(name: string): Promise<{ id: string; name: string }> {
  const { options, challenge } = await api.post<{ options: never; challenge: string }>("/auth/passkey/register-options", {});
  const response = await startRegistration({ optionsJSON: options });
  return api.post<{ id: string; name: string }>("/auth/passkey/register", { name, challenge, response });
}

export async function loginWithPasskey(): Promise<{ token: string }> {
  const { options, challenge } = await api.post<{ options: never; challenge: string }>("/auth/passkey/login-options", {});
  const response = await startAuthentication({ optionsJSON: options });
  return api.post<{ verified: boolean; token: string }>("/auth/passkey/login", { challenge, response });
}

export async function getPasskeyStatus(): Promise<{ enabled: boolean }> {
  return api.get<{ enabled: boolean }>("/auth/passkey/status");
}

export async function getPasskeyCredentials(): Promise<Array<{ id: string; name: string; createdAt: string }>> {
  const data = await api.get<{ credentials: Array<{ id: string; name: string; createdAt: string }> }>("/auth/passkey/credentials");
  return data.credentials;
}

export async function deletePasskey(id: string): Promise<void> {
  await api.delete(`/auth/passkey/credentials/${id}`);
}
