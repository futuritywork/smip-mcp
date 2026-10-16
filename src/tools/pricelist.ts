import type { McpApp } from "@futurity/plugins";
import { z } from "zod";
import type { ArtifactStore } from "../artifacts";
import type { SmipClient } from "../client";
import { SmipError } from "../http";

// Contract: SMI Mobile.postman_collection 15102026.json, Get/Show Pricelist.
// IDs are decimal strings (beyond JS integer precision), never path fragments.
const pricelistId = z.string().regex(/^[0-9]+$/).max(64).describe("Exact pricelist id returned by smip_list_pricelists.");
const metadata = z.object({
  id: pricelistId,
  title: z.string(),
  brand_name: z.string(),
  product_office: z.string(),
  last_upload: z.string(),
  last_upload_formatted: z.string(),
});
const envelope = z.object({ success: z.literal(true), status: z.string(), message: z.string() });
const listResponse = envelope.extend({ data: z.array(metadata.extend({
  has_price: z.boolean(), has_md_price: z.boolean(), has_promo: z.boolean(),
})) });
const reference = z.string().max(8192).nullish();
const detailResponse = envelope.extend({ data: metadata.extend({
  uploaded_by: z.string().nullish(), contact: z.string().nullish(),
  price_url: reference, md_price_url: reference,
}) });

/** Registers metadata reads and bounded, five-minute plugin-hosted XLSX capabilities. */
export function registerPricelistTools(app: McpApp, client: SmipClient, artifacts: ArtifactStore, publicUrl: string) {
  app.tool("smip_list_pricelists", {
    description: "List SMIP pricelist metadata and available variants. Pass a returned id as pricelist_id to smip_get_pricelist or smip_download_pricelist.",
    dangerLevel: "read",
    input: z.object({}),
    handler: (_input, { signal }) => client.get("/pricelist", listResponse, signal),
  });
  app.tool("smip_get_pricelist", {
    description: "Get metadata and price/md_price availability for an exact pricelist_id. Use smip_download_pricelist for a temporary XLSX download link.",
    dangerLevel: "read",
    input: z.object({ pricelist_id: pricelistId }),
    handler: async ({ pricelist_id }, { signal }) => {
      const response = await client.get(`/pricelist/${pricelist_id}`, detailResponse, signal);
      const { price_url, md_price_url, ...data } = response.data;
      return { ...response, data: { ...data, has_price: Boolean(price_url), has_md_price: Boolean(md_price_url) } };
    },
  });
  app.tool("smip_download_pricelist", {
    description: "Download a SMIP pricelist XLSX (variant price by default, or md_price). Returns a reusable plugin-hosted bearer link expiring in five minutes, not file contents. Anyone with the link can download it; keep it private. Maximum 10 MiB. Saving to sandbox/Vault is a separate step and is not guaranteed.",
    dangerLevel: "read",
    input: z.object({ pricelist_id: pricelistId, variant: z.enum(["price", "md_price"]).default("price") }),
    handler: async ({ pricelist_id, variant }, { signal }) => {
      const artifact = await artifacts.create(`pricelist-${pricelist_id}-${variant}.xlsx`, async downloadSignal => {
        const { data } = await client.get(`/pricelist/${pricelist_id}`, detailResponse, downloadSignal);
        const ref = variant === "price" ? data.price_url : data.md_price_url;
        if (!ref) throw new SmipError("Requested pricelist variant is unavailable.", 404);
        return client.download(ref, artifacts.maxFileBytes, downloadSignal);
      }, signal);
      const { id, ...metadata } = artifact;
      return { pricelist_id, variant, ...metadata, download_url: `${publicUrl}/downloads/${id}` };
    },
  });
}
