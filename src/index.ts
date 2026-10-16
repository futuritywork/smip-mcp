import { createSmipApp } from "./app";
import { SMIP_MOBILE_URL } from "./constants.ts";

const port = Number(process.env.PORT ?? 3000);
const app = createSmipApp({
  smipMobileUrl: (process.env.SMIP_MOBILE_URL ?? SMIP_MOBILE_URL).replace(/\/+$/, ""),
  signingKey: process.env.FUTURITY_SIGNING_KEY ?? "",
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
});
await app.listen(port);
