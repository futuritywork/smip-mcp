import { cors, mcp } from "@futurity/plugins";
import { SmipAuth } from "./auth";
import { credentialsMiddleware } from "./context";

/**
 * Creates an auth-only SDK app with a signed v3 manifest and public catalog.
 * The SDK validates signingKey (Ed25519 PKCS8 DER base64) at construction.
 * publicUrl is the externally reachable base URL; smipMobileUrl defaults to the
 * development API. Construction neither listens nor contacts SMIP.
 * Future handlers can use app.auth with currentCredentials(); no tools are registered.
 * stop() closes SDK transports.
 */
export function createSmipApp(options: {
  signingKey: string;
  publicUrl: string;
  smipMobileUrl?: string;
}) {
  const publicUrl = options.publicUrl.replace(/\/+$/, "");
  const auth = new SmipAuth(options.smipMobileUrl);
  const app = mcp({
    name: "smip-mcp",
    version: "0.1.0",
    path: "/mcp",
    instructions: "SMIP authentication skeleton. No tools are currently available.",
    pluginManifest: {
      specVersion: 3,
      pluginId: "smip-mcp",
      name: "SMIP",
      version: "0.1.0",
      mcpUrl: `${publicUrl}/mcp`,
      auth: { type: "none" },
      signingKey: options.signingKey,
    },
    catalog: {
      grant_type: "credentials",
      description: "SMIP authentication skeleton with organization-configured credentials. No tools are currently available.",
      category: "Business",
      icon_url: "https://www.synnexmetrodata.com/wp-content/uploads/2020/06/Logo-SMI-300-x-80-pixel.png",
      plugin_base_url: publicUrl,
      credential_schema: [
        { key: "smip_email", label: "SMIP email", type: "input", required: true },
        { key: "smip_password", label: "SMIP password", type: "password", required: true },
      ],
      metadata: {
        tagline: "SMIP organization connection",
        overview: "An administrator configures the organization’s SMIP email and password. This skeleton currently exposes no tools or datasets.",
        setupType: "admin",
      },
    },
  });
  cors({
    allowOrigin: "http://localhost:3000",
    allowHeaders: [
      "Content-Type", "Authorization", "Accept", "Mcp-Session-Id",
      "Mcp-Protocol-Version", "X-Futurity-Data-Params", "ngrok-skip-browser-warning",
    ],
    exposeHeaders: ["Mcp-Session-Id", "X-Futurity-Signature"],
  })(app);
  app.middleware(credentialsMiddleware);
  return Object.assign(app, { auth });
}
