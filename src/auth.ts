import { randomBytes } from "node:crypto";
import { hashKey } from "./utils";
import { z } from "zod";
import { fetchJson, SmipError } from "./http";

export { SmipError } from "./http";

import {
  DEFAULT_SMIP_MOBILE_URL, REQUEST_TIMEOUT_MS, SESSION_IDLE_TTL_MS,
  TOKEN_REFRESH_LEAD_MS, TOKEN_REFRESH_LEAD_RATIO,
} from "./constants";

/** The marketplace connection fields; passwords are preserved verbatim. */
export const credentialsSchema = z
  .object({ smip_email: z.email(), smip_password: z.string().min(1) })
  .strict();
export type SmipCredentials = z.infer<typeof credentialsSchema>;

const authResponseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(false) }),
  z.object({ success: z.literal(true), data: z.object({
    token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
    access_token: z.string().min(1),
    expires_in: z.number().positive().max(Number.MAX_SAFE_INTEGER / 1000),
    refresh_token: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
  }) }),
]);

type Session = {
  accessToken: string;
  refreshToken?: string;
  provider?: string;
  refreshAt: number;
  idleExpiresAt: number;
};

/**
 * Owns an app-local, credential-keyed login/refresh cache matching marketplace SMIP.
 * Cached sessions store tokens, not passwords, and expire lazily after 24 hours idle.
 * A random per-instance HMAC key separates credential identities, including password changes.
 * Concurrent exchanges for one identity are shared; requests time out after 15 seconds
 * independently of caller cancellation. Cache and in-flight identity counts are unbounded.
 */
export class SmipAuth {
  private readonly salt = randomBytes(32);
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<Session>>();

  /** baseUrl is trusted server configuration; now returns Unix milliseconds. */
  constructor(private readonly baseUrl = DEFAULT_SMIP_MOBILE_URL, private readonly now = Date.now) {}

  /**
   * Acquires an internal token using boundary-validated credentials.
   * Refresh rejection (400/401/403) falls back to login; outages and rate limits propagate.
   * Invalidation marks only the returned session stale, leaving newer replacements intact.
   */
  async authenticate(credentials: SmipCredentials) {
    const key = hashKey([credentials.smip_email, credentials.smip_password], this.salt);
    const timestamp = this.now();
    for (const [key, session] of this.sessions) {
      if (session.idleExpiresAt <= timestamp) this.sessions.delete(key);
    }
    let session = this.sessions.get(key);
    if (session && timestamp < session.refreshAt) {
      session.idleExpiresAt = timestamp + SESSION_IDLE_TTL_MS;
    } else {
      let operation = this.pending.get(key);
      if (!operation) {
        operation = this.acquire(key, credentials).finally(() => this.pending.delete(key));
        this.pending.set(key, operation);
      }
      session = await operation;
    }
    return { accessToken: session.accessToken, invalidate: () => { session.refreshAt = 0; } };
  }

  private async acquire(key: string, credentials: SmipCredentials): Promise<Session> {
    const previous = this.sessions.get(key);
    let session: Session | undefined;
    if (previous?.refreshToken && previous.provider) {
      try {
        session = await this.exchange("refresh", {
          refresh_token: previous.refreshToken, provider: previous.provider,
        }, previous);
      } catch (error) {
        // Match marketplace: re-login after rejection, not during outages or rate limits.
        if (!(error instanceof SmipError) || ![400, 401, 403].includes(error.status)) throw error;
      }
    }
    if (!session) {
      this.sessions.delete(key);
      session = await this.exchange("login", {
        email: credentials.smip_email, password: credentials.smip_password,
      });
    }
    this.sessions.set(key, session);
    return session;
  }

  private async exchange(
    kind: "login" | "refresh",
    body: Record<string, string>,
    previous?: Session,
  ): Promise<Session> {
    const startedAt = this.now();
    const payload = await fetchJson(`${this.baseUrl}/auth/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        ...(previous ? { Authorization: `Bearer ${previous.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, authResponseSchema);
    if (!payload.success) throw new SmipError(`SMIP ${kind} rejected. Check your credentials.`, 401);
    const token = payload.data;
    const lifetimeMs = token.expires_in * 1000;
    const refreshAt = startedAt + lifetimeMs - Math.min(TOKEN_REFRESH_LEAD_MS, lifetimeMs * TOKEN_REFRESH_LEAD_RATIO);
    if (refreshAt <= this.now()) throw new SmipError(`SMIP ${kind} token already expired.`);
    return {
      accessToken: token.access_token,
      // An omitted provider is retained; an omitted refresh token is not reused.
      refreshToken: token.refresh_token,
      provider: token.provider ?? previous?.provider,
      refreshAt,
      idleExpiresAt: this.now() + SESSION_IDLE_TTL_MS,
    };
  }
}
