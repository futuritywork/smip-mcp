import type { z } from "zod";

/** A caller-safe failure with an HTTP status and no upstream body or exception details. */
export class SmipError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "SmipError";
  }
}

/** Sends once without redirects; parses JSON (null for 204) and sanitizes failures. */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error" });
  } catch {
    throw new SmipError("SMIP request unavailable.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SmipError("SMIP request failed.", response.status);
  }
  try {
    const payload: unknown =
      response.status === 204 ? null : await response.json();
    return await schema.parseAsync(payload);
  } catch {
    throw new SmipError("Invalid SMIP response.");
  }
}
