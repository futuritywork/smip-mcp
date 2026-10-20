import { cors, mcp } from "@futurity/plugins";
import { SmipAuth } from "./auth";
import { ArtifactStore } from "./artifacts";
import { SmipClient } from "./client";
import { DEFAULT_SMIP_MOBILE_URL } from "./constants";
import { credentialsMiddleware } from "./context";
import { registerStockTools } from "./tools/stock";
import { registerPricelistTools } from "./tools/pricelist";

/**
 * Creates a read-only stock/pricelist app with a signed v4 discovery manifest.
 * The SDK validates signingKey (Ed25519 PKCS8 DER base64) at construction.
 * publicUrl is the externally reachable base URL; smipMobileUrl defaults to the
 * development API. Construction neither listens nor contacts SMIP.
 * Tools share app.auth and use the calling request's credentials.
 * stop() closes SDK transports, aborts artifact loads and removes temporary files.
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
    instructions: "Search SMIP materials with smip_search_materials, then pass a returned part_number to smip_check_stock for quantities by storage location. List pricelists with smip_list_pricelists, and obtain a five-minute XLSX/PDF capability link with smip_download_pricelist. Keep download links private; saving them to sandbox/Vault is separate. All tools are read-only. Organization credentials are supplied through the request header, never tool arguments. Sales-order tools are not available.",
    pluginManifest: {
      pluginId: "smip-mcp",
      developerEmail: "admin@futurity.work",
      name: "SMIP",
      version: "0.1.0",
      mcpUrl: `${publicUrl}/mcp`,
      auth: {
        type: "none",
        grantType: "credentials",
        credentials_schema: [
          { key: "smip_email", label: "SMIP email", type: "input", required: true },
          { key: "smip_password", label: "SMIP password", type: "password", required: true },
        ],
      },
      signingKey: options.signingKey,
      description: "Search SMIP materials, check stock and download pricelists using organization-configured credentials.",
      category: "Business",
      icon: "https://www.synnexmetrodata.com/wp-content/uploads/2020/06/Logo-SMI-300-x-80-pixel.png",
      metadata: {
        tagline: "SMIP stock and pricelist downloads",
        overview: "An administrator configures the organization’s SMIP email and password. Search materials by part number or description, then check on-hand, sales-order-booked and available quantities by storage location. List pricelists and create private five-minute plugin-hosted XLSX/PDF download links (maximum 10 MiB). Links are bearer capabilities; sandbox/Vault saving is separate and end-to-end delivery is not guaranteed. All four tools are read-only; sales-order tools are not included.",
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
  const artifacts = new ArtifactStore();
  app.middleware(credentialsMiddleware);
  app.middleware(artifacts.middleware);
  const client = new SmipClient(auth, smipMobileUrl);
  registerStockTools(app, client);
  registerPricelistTools(app, client, artifacts, publicUrl);
  const stop = app.stop.bind(app);
  app.stop = async () => {
    artifacts.stop();
    await stop();
  };
  return Object.assign(app, { auth });
}
