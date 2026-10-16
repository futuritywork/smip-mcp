/** Startup settings read once from trusted environment configuration. */
export const PORT = Number(process.env.PORT ?? 3000);
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
export const FUTURITY_SIGNING_KEY = process.env.FUTURITY_SIGNING_KEY ?? "";
export const DEFAULT_SMIP_MOBILE_URL = "https://smipdev.synnexmetrodata.com/mobile";
export const SMIP_MOBILE_URL = (process.env.SMIP_MOBILE_URL ?? DEFAULT_SMIP_MOBILE_URL).replace(/\/+$/, "");

export const CREDENTIALS_HEADER = "X-Futurity-Data-Params";

export const REQUEST_TIMEOUT_MS = 15_000;
export const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
export const TOKEN_REFRESH_LEAD_MS = 60_000;
export const TOKEN_REFRESH_LEAD_RATIO = 0.1;
