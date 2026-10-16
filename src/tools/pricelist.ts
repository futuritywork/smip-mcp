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
// Production lists omit status/message; Postman examples include both strings.
const listResponse = envelope.partial({ status: true, message: true }).extend({ data: z.array(metadata.extend({
  has_price: z.boolean(), has_md_price: z.boolean(), has_promo: z.boolean(),
})) });
const reference = z.string().max(8192).nullish();
const detailResponse = envelope.extend({ data: metadata.extend({
  uploaded_by: z.string().nullish(), contact: z.string().nullish(),
  price_url: reference, md_price_url: reference,
}) });

const downloadOutput = z.object({
  pricelist_id: pricelistId,
  variant: z.enum(["price", "md_price"]),
  filename: z.string(),
  size_bytes: z.number().int().positive(),
  content_type: z.string(),
  expires_at: z.iso.datetime(),
  download_url: z.url(),
});

/** Registers metadata reads and bounded, five-minute plugin-hosted XLSX capabilities. */
export function registerPricelistTools(app: McpApp, client: SmipClient, artifacts: ArtifactStore, publicUrl: string) {
  app.tool("smip_list_pricelists", {
    description: "List SMIP pricelist metadata and available variants. Pass a returned id as pricelist_id to smip_download_pricelist.",
    dangerLevel: "read",
    input: z.object({}),
    output: listResponse,
    handler: (_input, { signal }) => client.get("/pricelist", listResponse, signal),
  });
  app.tool("smip_download_pricelist", {
    description: "Download a SMIP pricelist XLSX (variant price by default, or md_price). Returns a reusable plugin-hosted bearer link expiring in five minutes, not file contents. Anyone with the link can download it; keep it private. Maximum 10 MiB. Saving to sandbox/Vault is a separate step and is not guaranteed.",
    dangerLevel: "read",
    input: z.object({ pricelist_id: pricelistId, variant: z.enum(["price", "md_price"]).default("price") }),
    output: downloadOutput,
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
