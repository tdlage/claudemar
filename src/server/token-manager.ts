import { randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "../config.js";

const GRACE_PERIOD_MS = 5 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    const padded = Buffer.alloc(bufA.length, 0);
    bufB.copy(padded, 0, 0, Math.min(bufB.length, padded.length));
    timingSafeEqual(bufA, padded);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

class TokenManager extends EventEmitter {
  private currentToken: string;
  private previousToken: string | null = null;
  private graceTimeout: ReturnType<typeof setTimeout> | null = null;
  private rotationInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.currentToken = generateToken();
  }

  getCurrentToken(): string {
    return this.currentToken;
  }

  validate(candidate: string): boolean {
    if (!candidate) return false;

    if (config.dashboardToken && safeCompare(config.dashboardToken, candidate)) {
      return true;
    }

    if (safeCompare(this.currentToken, candidate)) {
      return true;
    }

    if (this.previousToken && safeCompare(this.previousToken, candidate)) {
      return true;
    }

    return false;
  }

  rotate(): void {
    if (this.graceTimeout) {
      clearTimeout(this.graceTimeout);
    }

    this.previousToken = this.currentToken;
    this.currentToken = generateToken();

    this.graceTimeout = setTimeout(() => {
      this.previousToken = null;
      this.graceTimeout = null;
      this.emit("grace:expired");
    }, GRACE_PERIOD_MS);

    this.emit("rotate");
  }

  start(): void {
    const intervalMs = config.tokenRotationHours * 60 * 60 * 1000;
    this.rotationInterval = setInterval(() => this.rotate(), intervalMs);
  }

  stop(): void {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
      this.rotationInterval = null;
    }
    if (this.graceTimeout) {
      clearTimeout(this.graceTimeout);
      this.graceTimeout = null;
    }
  }
}

export const tokenManager = new TokenManager();
