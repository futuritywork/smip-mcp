import { cors, mcp } from "@futurity/plugins";
import { SmipAuth } from "./auth";
import { SmipClient } from "./client";
import { DEFAULT_SMIP_MOBILE_URL } from "./constants";
import { credentialsMiddleware } from "./context";
import { registerStockTools } from "./tools/stock";

/**
 * Creates a read-only stock SDK app with a signed v3 manifest and public catalog.
 * The SDK validates signingKey (Ed25519 PKCS8 DER base64) at construction.
 * publicUrl is the externally reachable base URL; smipMobileUrl defaults to the
 * development API. Construction neither listens nor contacts SMIP.
 * Stock tools share app.auth and use the calling request's credentials.
 * stop() closes SDK transports.
 */
export function createSmipApp(options: {
  signingKey: string;
  publicUrl: string;
  smipMobileUrl?: string;
}) {
  const publicUrl = options.publicUrl.replace(/\/+$/, "");
  const smipMobileUrl = (options.smipMobileUrl ?? DEFAULT_SMIP_MOBILE_URL).replace(/\/+$/, "");
  const auth = new SmipAuth(smipMobileUrl);
  const app = mcp({
    name: "smip-mcp",
    version: "0.1.0",
    path: "/mcp",
    instructions: "Search SMIP materials with smip_search_materials, then pass a returned part_number to smip_check_stock for quantities by storage location. Both tools are read-only. Organization credentials are supplied through the request header, never tool arguments. Sales-order tools are not available.",
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
      description: "Search SMIP materials and check stock by storage location using organization-configured credentials.",
      category: "Business",
      icon_url: "https://www.synnexmetrodata.com/wp-content/uploads/2020/06/Logo-SMI-300-x-80-pixel.png",
      plugin_base_url: publicUrl,
      credential_schema: [
        { key: "smip_email", label: "SMIP email", type: "input", required: true },
        { key: "smip_password", label: "SMIP password", type: "password", required: true },
      ],
      metadata: {
        tagline: "SMIP material search and stock availability",
        overview: "An administrator configures the organization’s SMIP email and password. Search materials by part number or description, then check on-hand, sales-order-booked and available quantities by storage location. These two tools are read-only; sales-order tools are not included.",
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
  registerStockTools(app, new SmipClient(auth, smipMobileUrl));
  return Object.assign(app, { auth });
}
