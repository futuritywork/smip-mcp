import { createHmac } from "node:crypto";

/** Returns a hex HMAC-SHA256 cache key for an ordered tuple using a caller-owned secret. */
export function hashKey(parts: readonly string[], secret: Uint8Array): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify(parts))
    .digest("hex");
}
