# SMIP MCP — stock and pricelist downloads

A Bun/TypeScript MCP app using the existing `@futurity/plugins` factory.
Includes two read-only stock tools ported from
`futurity-marketplace/plugins/smip/src/tools/stock.ts` (the source is unchanged):

- `smip_search_materials({ query })`: search part numbers/descriptions; returns
  `part_number` and `part_number_desc` entries.
- `smip_check_stock({ part_number })`: check an exact returned part number; returns
  on-hand, sales-order-booked and available quantities by storage location.

Both stock inputs are trimmed, must be nonempty strings, and are URL-encoded.
Both results retain the source `{ success: true, status, message, data }` shape
and are runtime-validated before the SDK returns them as both structured content
and JSON text content.

Two additional read-only tools follow the Get/Show/Download Pricelist examples
in `futurity-marketplace/SMI Mobile.postman_collection 15102026.json`:

- `smip_list_pricelists({})`: metadata including string `id`, title, brand, product
  office, upload dates and `has_price`/`has_md_price`/`has_promo` flags.
- `smip_download_pricelist({ pricelist_id, variant? })`: `variant` is `price`
  (default) or `md_price`. Returns `download_url`, generated `filename`,
  `size_bytes`, `content_type`, `expires_at`, `pricelist_id` and `variant`.
  No base64 or file contents are put into MCP output.

Pricelist IDs must be decimal strings (at most 64 digits), not paths or numbers.
List/detail results are runtime-validated. Missing, null or empty variant
references mean unavailable; requesting one returns a tool error. Promo downloads
are not supported. References are percent-decoded once and query-encoded into
`/pricelist/download?id=...` on the trusted SMIP base, never fetched as arbitrary URLs.

Sales-order tools are excluded. There is no authentication tool or endpoint
that returns tokens, chained login, platform JWT, SQLite store or custom transport.

## Run locally

`@futurity/plugins` uses the local `file:../plugins/packages/plugins` dependency
(version 3). Keep that sibling checkout available. Build its exported `dist/`
with its existing dependencies before installing this app:

```sh
(cd ../plugins/packages/plugins && bun run build)
bun install
cp .env.example .env
bun run keygen
# Put the generated FUTURITY_SIGNING_KEY private key in .env; retain the public key.
bun run start
# or: bun run dev
bun test
bun run check
```

If the sibling's build dependencies are missing, provision them separately before
building. Rebuild the sibling and rerun `bun install` here after SDK changes.

The SDK's `app.listen()` binds to `0.0.0.0:3000` by default and uses Bun's default request-body limit. See `.env.example` for listener settings
and the trusted upstream URL. The SDK requires a valid Ed25519 signing key at
startup. No database, platform trust settings or SMIP credentials are required.
Do not put organization credentials in `.env`, tool arguments, URLs, logs, or source control.

- `GET /.well-known/health-check`: SDK process health, not an upstream authentication check.
- `/mcp`: SDK HTTP transport; every request requires the credential header below.
- `GET /.well-known/futurity/plugin`: v3 manifest with detached Ed25519 JWS in
  `X-Futurity-Signature`.
- `GET /api/catalog`: one public catalog object (not an array); other methods return 405.
- `GET /downloads/<random identifier>`: temporary XLSX bearer-capability download;
  `HEAD` returns headers without consuming it. No credential header is needed.
- Former `/auth/*` routes: 404.

MCP initialization succeeds with valid credential **shape** and advertises the
tools capability. `tools/list` exposes exactly the four tools above. Initialization,
discovery, catalog and health requests do not contact SMIP.

## Temporary downloads and cleanup

The plugin authenticates to SMIP on behalf of the calling credential pair, loads
at most **10 MiB per file** by bounded stream reads, then issues a cryptographically
random 256-bit capability link based on `PUBLIC_URL`. Treat the entire link as a
**bearer secret**: anyone who obtains it can retrieve the file until expiry. Links
are not bound to an MCP session or user, and are intentionally reusable until
**five minutes after creation**. Keep links out of logs, analytics and shared chat;
configure ingress/access logging to redact `/downloads/*` paths. The app does not
log capability identifiers, references or credentials.

Files stay in app-local memory only: **five files total, stored plus pending**,
with fixed limits of **10 MiB per file** and a **five-minute TTL**. Each pending
download reserves one slot before metadata/auth/download work begins; capacity
exhaustion returns a sanitized tool error without evicting unexpired links.
This intentionally reduces small-file capacity from the previous 20-artifact,
50 MiB budget: even five tiny files fill the store. The slot and per-file limits
bound stored payloads plus upstream reservations to 50 MiB without separate
byte accounting. Failed/cancelled operations release reservations when their loads
settle. These limits exclude runtime overhead and already-issued HTTP response
buffers.

Expiry is checked immediately on access and admission, with periodic cleanup
every 30 seconds on an unref'ed timer. `app.stop()` clears that timer and all
files, aborts pending artifact loads and closes SDK transports. Already-issued
HTTP bodies may finish streaming; shared authentication still completes under
its independent timeout. **Process restart invalidates all links**. There is no
disk persistence or cross-process store: multiple instances need routing to the
issuing process. Expired/unknown links return 404; other methods return 405.
Responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, XLSX content type and a safe generated attachment
filename; upstream filenames are ignored.

These plugin-hosted links are the temporary delivery mechanism, not sandbox or
Vault storage. Saving a downloaded file to sandbox/Vault is a **separate step**
requiring appropriate client support and access to the public plugin URL before
expiry. No end-to-end download, sandbox/Vault save or platform compatibility is
guaranteed by these tools or local tests.

## Cancellation

The SDK supplies `handler(input, { signal })`. All tools pass that signal
through to business I/O, combined with its independent 15-second timeout. MCP
request cancellation (or SDK connection closure) aborts an in-flight business
fetch, including download body reads. Metadata and binary requests each have their
own timeout. Cancellation is checked before and after authentication, so an already
cancelled call starts no upstream work and cancellation during authentication
prevents its business request. Shared login/refresh exchanges finish independently
under their own 15-second timeout; cancelling one caller does not disrupt others.
Requests are never replayed automatically.

## SDK output schemas and annotation limits

All four tools declare their final object outputs. `tools/list` advertises MCP
`outputSchema`; successful calls include matching `structuredContent` alongside
JSON text. The app validates upstream responses, and the SDK validates the final
result. Pricelist detail schemas omit opaque references and expose availability
flags; the download schema describes link metadata only, never binary contents.

Remaining annotation limitation:
- Full source annotations are unavailable. `dangerLevel: "read"` publishes
  `readOnlyHint: true`, `destructiveHint: false` and `futurity:dangerLevel: "read"`;
  `idempotentHint` and `openWorldHint` are not advertised.

This requires the sibling SDK build with output-schema support; no compatibility
layer is included.

## Authentication contract

Adapted from `futurity-marketplace/plugins/smip/src/auth.ts` and `src/app.ts`:

```http
X-Futurity-Data-Params: {"smip_email":"user@example.test","smip_password":"placeholder"}
```

`credentialsSchema` requires exactly `smip_email` (email) and `smip_password`
(nonempty string). Passwords are preserved verbatim. Missing/malformed JSON,
wrong types, and extra fields produce a generic HTTP 400 before downstream work.
The fields live in async request-local context, never a shared current-user
variable. Shape validation is **not** verification of an SMIP account or a trusted
platform caller. Bearer tokens and query/body fields cannot replace this header.

`createSmipApp({ signingKey, publicUrl, smipMobileUrl? })` owns one `SmipAuth`
instance as `app.auth`. All tools reuse it with `currentCredentials()`;
the returned access token is for upstream requests only, never MCP output.
Each tool authenticates just before its business request. Auth and data use the
same trusted upstream URL (with trailing slashes removed).

Business GETs send bearer authorization once, without retries, redirects or replay.
A business 401 marks only the session used stale; renewal happens on the next
explicit call, not by replaying the rejected call. HTTP/network/validation
failures expose sanitized messages, never upstream error bodies or exception
details. The source client status mapping is retained internally (401/403/429/502;
other business failures become 502); the SDK presents failures as MCP tool errors.

The cache follows marketplace behavior:

- POST `/auth/login` with `{ email, password }` on first use.
- Separate caches per app and credential pair (including password changes), keyed
  by a random per-instance HMAC; cached sessions contain tokens, not passwords.
  Credentials remain transiently in request context and pending exchanges.
- Concurrent acquisition for the same credentials shares one exchange.
- Early refresh at expiry minus the smaller of 60 seconds or 10% of lifetime.
  POST `/auth/refresh` sends the previous bearer plus `{ refresh_token, provider }`.
- Refresh rejection (400/401/403 or `success:false`) falls back to login; outages,
  invalid responses and rate limits propagate sanitized errors instead.
- Missing refresh credentials require login. An omitted rotated refresh token is
  not reused; an omitted provider is retained. A failed refresh remains eligible
  for retry on a later call, matching marketplace behavior.
- Sessions expire lazily after 24 hours idle. State is memory-only and lost on
  restart; identity/cache counts are unbounded, as in the source implementation.
- Exchanges have a 15-second timeout independent of caller cancellation; redirects
  are forbidden and upstream error bodies/details are not exposed.

`SMIP_MOBILE_URL` defaults to the marketplace's **development** API at
`https://smipdev.synnexmetrodata.com/mobile`. A configured override must be HTTPS
without embedded credentials, query or fragment. Configuration is trusted and
is not validated at startup; it must never come from user input. No live SMIP calls were used to validate this port.

## Futurity discovery and registration

Set `PUBLIC_URL` to the reachable HTTPS base URL before registration. It defaults
to `http://localhost:${PORT}` locally, with `PORT` defaulting to 3000. The
manifest MCP URL, catalog base URL and temporary download links use this setting. The SDK publishes and
signs this manifest (using your configured URL):

```json
{
  "specVersion": 3,
  "pluginId": "smip-mcp",
  "name": "SMIP",
  "version": "0.1.0",
  "auth": { "type": "none" },
  "mcpUrl": "https://your-plugin.example/mcp"
}
```

The SDK derives catalog `slug`, `name` and `mcp_url` from that manifest. The
catalog declares `grant_type: "credentials"`, required `smip_email` input and
`smip_password` password fields, and `metadata.setupType: "admin"`. These are field
definitions, never credential values. There is no plugin token endpoint.

Use the public key from `bun run keygen` when registering/verifying the manifest
in Futurity. Keep the private key only in trusted server configuration. End-to-end
platform discovery, organization credential UI and header delivery still need to be
verified in the target deployment.

Do not expose this as a production authenticated gateway. `auth:none` describes
the platform protocol, not anonymous access to SMIP data. This app
does not verify platform assertions, enforce caller identity or bind SDK MCP
session IDs to users. The installed SDK owns process-local transports; their
resource limits and lifecycle are not hardened here. The listener binds to all
interfaces; restrict network access and use a trusted HTTPS ingress. A separate
security review is required before production exposure. Protect the credential
header from proxy/access logging.

## Layout and checks

- `src/app.ts`, `src/index.ts`: SDK app and listener.
- `src/context.ts`: strict credential boundary and request-local access.
- `src/auth.ts`, `src/http.ts`: app-local login/refresh cache and sanitized I/O.
- `src/client.ts`, `src/tools/stock.ts`, `src/tools/pricelist.ts`: authenticated reads/downloads and runtime schemas.
- `src/artifacts.ts`: bounded in-memory capabilities, expiry, routes and shutdown.
- `scripts/keygen.ts`: Ed25519 keypair generator.

`src/constants.ts` exports environment settings, the credentials header name,
and auth timing constants.

Run `bun run check` for TypeScript validation. Automated tests are not currently
included.

TypeScript uses `preserveSymlinks` so the file-linked SDK resolves this app's peer
types rather than a sibling checkout's different Zod version. No dependencies
or SDK files are changed for this setting.

These checks do not establish live SMIP or end-to-end Futurity compatibility.
Existing ignored databases or private configuration are not migrated or deleted;
they are no longer read.
