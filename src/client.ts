import type { z } from "zod";
import type { SmipAuth } from "./auth";
import { REQUEST_TIMEOUT_MS } from "./constants";
import { currentCredentials } from "./context";
import { fetchDownload, fetchJson, SmipError } from "./http";

/**
 * Reads SMIP data with the app's auth cache and request-local credentials.
 * Requests are sent once and responses are validated. A business 401 invalidates
 * only the session used, for renewal on the next explicit call (never replay).
 */
export class SmipClient {
  /** baseUrl must be the same trusted mobile API URL used by auth. */
  constructor(private readonly auth: SmipAuth, private readonly baseUrl: string) {}

  /**
   * Downloads an opaque percent-encoded SMIP reference through the fixed trusted
   * endpoint. Decodes once then query-encodes; the reference is never a fetch URL.
   * Uses request credentials, a 15-second body-inclusive timeout and no replay.
   */
  async download(reference: string, maxBytes: number, caller?: AbortSignal) {
    let id: string;
    try { id = decodeURIComponent(reference); }
    catch { throw new SmipError("Invalid SMIP download reference."); }
    if (caller?.aborted) throw new SmipError("SMIP request cancelled.", 499);
    const authorization = await this.auth.authenticate(currentCredentials());
    if (caller?.aborted) throw new SmipError("SMIP request cancelled.", 499);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await fetchDownload(`${this.baseUrl}/pricelist/download?${new URLSearchParams({ id })}`, {
        method: "GET",
        headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Authorization: `Bearer ${authorization.accessToken}` },
        signal: caller ? AbortSignal.any([timeout, caller]) : timeout,
      }, maxBytes);
    } catch (error) {
      if (error instanceof SmipError) {
        if (error.status === 401) authorization.invalidate();
        if ([401, 403, 429, 502].includes(error.status)) throw error;
      }
      throw new SmipError("SMIP download failed.");
    }
  }

  /**
   * Reads a developer-controlled relative path with a 15-second business timeout.
   * Caller cancellation skips or aborts business I/O; shared auth finishes independently.
   */
  async get<S extends z.ZodType>(path: string, responseSchema: S, caller?: AbortSignal): Promise<z.infer<S>> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new SmipError("Unsupported SMIP endpoint.", 400);
    if (caller?.aborted) throw new SmipError("SMIP request cancelled.", 499);
    const authorization = await this.auth.authenticate(currentCredentials());
    if (caller?.aborted) throw new SmipError("SMIP request cancelled.", 499);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await fetchJson(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${authorization.accessToken}`,
        },
        signal: caller ? AbortSignal.any([timeout, caller]) : timeout,
      }, responseSchema);
    } catch (error) {
      if (error instanceof SmipError) {
        if (error.status === 401) authorization.invalidate();
        if ([401, 403, 429, 502].includes(error.status)) throw error;
      }
      throw new SmipError("SMIP request failed.");
    }
  }
}
