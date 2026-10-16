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

/** Owned binary chunks, bounded during reading; size is their total byte length. */
export type DownloadBody = { chunks: Uint8Array[]; size: number };

/**
 * Reads once without redirects, retaining at most maxBytes of response chunks.
 * The signal covers headers and body reads. Error bodies and upstream filenames
 * are discarded; HTTP errors, stream failures and oversized/empty files are sanitized.
 */
export async function fetchDownload(url: string, init: RequestInit, maxBytes: number): Promise<DownloadBody> {
  let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel" | "releaseLock"> | undefined;
  const abort = () => { void reader?.cancel().catch(() => {}); };
  try {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SmipError("SMIP download failed.", response.status);
    }
    const length = response.headers.get("Content-Length");
    if (length && Number(length) > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new SmipError("SMIP download exceeds the file size limit.");
    }
    if (!response.body) throw new SmipError("Empty SMIP download.");
    reader = response.body.getReader();
    init.signal?.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (init.signal?.aborted) throw new SmipError("SMIP download cancelled.");
      const chunk = await reader.read();
      if (init.signal?.aborted) throw new SmipError("SMIP download cancelled.");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new SmipError("SMIP download exceeds the file size limit.");
      if (chunk.value.byteLength) chunks.push(chunk.value);
    }
    if (!size) throw new SmipError("Empty SMIP download.");
    return { chunks, size };
  } catch (error) {
    if (error instanceof SmipError) throw error;
    throw new SmipError("SMIP download unavailable.");
  } finally {
    init.signal?.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
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
