import { randomBytes } from "node:crypto";
import type { Middleware } from "@futurity/plugins";
import { PDF_TYPE, SmipError, type DownloadBody } from "./http";

const TTL_MS = 5 * 60 * 1000;
const MAX_FILES = 80;

type Artifact = DownloadBody & { filename: string; expiresAt: number };

/**
 * Owns temporary bearer-capability files and in-flight capacity reservations.
 * Up to ten stored/pending files share capacity, each bounded to 10 MiB.
 * Loads reserve one slot; successes retain it for five minutes, failures release it.
 * stop() aborts loads, clears files and the unref'ed cleanup timer, and closes the store.
 */
export class ArtifactStore {
  private readonly files = new Map<string, Artifact>();
  private readonly pending = new Set<AbortController>();
  private stopped = false;
  private readonly timer: ReturnType<typeof setInterval>;
  readonly maxFileBytes = 10 * 1024 * 1024;

  /** now returns Unix milliseconds; production uses the system clock. */
  constructor(private readonly now: () => number = Date.now) {
    this.timer = setInterval(() => this.cleanup(), 30_000);
    this.timer.unref();
  }

  /** Removes files expiring at or before now, reclaiming their capacity. */
  cleanup(): void {
    for (const [id, file] of this.files) {
      if (file.expiresAt <= this.now()) this.files.delete(id);
    }
  }

  /**
   * Loads a bounded body under a reservation and returns small public link metadata.
   * filenameStem is a generated pricelist name; the loaded media type selects its extension.
   * load transfers ownership of its chunks to this store and must respect its signal.
   * Caller cancellation and shutdown prevent publication even if load finishes late.
   */
  async create(filenameStem: string, load: (signal: AbortSignal) => Promise<DownloadBody>, caller?: AbortSignal) {
    this.cleanup();
    if (this.stopped || caller?.aborted) throw new SmipError("Download cancelled.", 499);
    if (!/^pricelist-[0-9]+-(price|md_price)$/.test(filenameStem)) throw new SmipError("Invalid download filename.", 400);
    if (this.files.size + this.pending.size >= MAX_FILES)
      throw new SmipError("Temporary download capacity reached. Try again after links expire.", 429);
    const controller = new AbortController();
    this.pending.add(controller);
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    try {
      const body = await load(signal);
      if (this.stopped || signal.aborted) throw new SmipError("Download cancelled.", 499);
      const size = body.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      if (size === 0 || size > this.maxFileBytes || size !== body.size) throw new SmipError("Invalid download size.");
      const filename = `${filenameStem}.${body.contentType === PDF_TYPE ? "pdf" : "xlsx"}`;
      const id = randomBytes(32).toString("hex");
      const expiresAt = this.now() + TTL_MS;
      this.files.set(id, { ...body, filename, expiresAt });
      return { id, filename, size_bytes: size, content_type: body.contentType, expires_at: new Date(expiresAt).toISOString() };
    } finally {
      this.pending.delete(controller);
    }
  }

  /** Serves reusable GET/HEAD capabilities; missing and expired identifiers both return 404. */
  readonly middleware: Middleware = async (request, next) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/downloads/")) return next(request);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD");
      return new Response(null, { status: 405, headers });
    }
    this.cleanup();
    const id = path.slice("/downloads/".length);
    const file = /^[a-f0-9]{64}$/.test(id) ? this.files.get(id) : undefined;
    if (!file) return new Response(null, { status: 404, headers });
    headers.set("Content-Type", file.contentType);
    headers.set("Content-Disposition", `attachment; filename="${file.filename}"`);
    headers.set("Content-Length", String(file.size));
    let index = 0;
    const body = request.method === "HEAD" ? null : new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = file.chunks[index++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    return new Response(body, { headers });
  };

  /** Releases app-owned state; already-issued HTTP response bodies may finish streaming. */
  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.files.clear();
  }
}
