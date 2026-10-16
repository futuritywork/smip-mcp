import { AsyncLocalStorage } from "node:async_hooks";
import type { Middleware } from "@futurity/plugins";
import { credentialsSchema, type SmipCredentials } from "./auth";
import { CREDENTIALS_HEADER } from "./constants";

const context = new AsyncLocalStorage<Readonly<SmipCredentials>>();

/** Returns this request's validated credentials; throws outside the MCP boundary. */
export function currentCredentials(): Readonly<SmipCredentials> {
  const credentials = context.getStore();
  if (!credentials) throw new Error("SMIP request credentials required.");
  return credentials;
}

/**
 * Validates the JSON X-Futurity-Data-Params header on every /mcp request and
 * scopes credentials to downstream async work. Invalid input returns a sanitized 400.
 * This validates shape, not account ownership or the caller's platform identity.
 */
export const credentialsMiddleware: Middleware = async (request, next) => {
  if (new URL(request.url).pathname !== "/mcp") return next(request);
  let input: unknown;
  try { input = JSON.parse(request.headers.get(CREDENTIALS_HEADER) ?? "{}"); }
  catch { input = undefined; }
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return Response.json(
    { error: "Invalid SMIP user credential parameters." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
  return context.run(Object.freeze(parsed.data), () => next(request));
};
