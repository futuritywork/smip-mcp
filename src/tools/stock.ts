import type { McpApp } from "@futurity/plugins";
import { z } from "zod";
import type { SmipClient } from "../client";

const materialsResponse = z.object({
  success: z.literal(true),
  status: z.string(),
  message: z.string(),
  data: z.array(
    z.object({ part_number: z.string(), part_number_desc: z.string() }),
  ),
});

const stockResponse = z.object({
  success: z.literal(true),
  status: z.string(),
  message: z.string(),
  data: z.array(
    z.object({
      material: z.string(),
      material_name: z.string(),
      storage_location: z.string(),
      storage_location_name: z.string().optional(),
      on_hand_qty: z.number(),
      booked_by_so: z.number(),
      available_qty: z.number(),
    }),
  ),
});

/** Registers stock reads with runtime response validation and supported read-only metadata. */
export function registerStockTools(app: McpApp, client: SmipClient) {
  app.tool("smip_search_materials", {
    description:
      "Search SMIP materials with a free-text query (part number or description). Pass a returned part_number to smip_check_stock using its part_number input.",
    dangerLevel: "read",
    input: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .describe("Part number or description to search for."),
    }),
    handler: ({ query }, { signal }) =>
      client.get(
        `/stock/get-pn?${new URLSearchParams({ q: query })}`,
        materialsResponse,
        signal,
      ),
  });

  app.tool("smip_check_stock", {
    description:
      "Check SMIP stock for an exact part_number. Returns on-hand, sales-order-booked and available quantities by storage location.",
    dangerLevel: "read",
    input: z.object({
      part_number: z
        .string()
        .trim()
        .min(1)
        .describe(
          "Exact part number, such as one returned by smip_search_materials.",
        ),
    }),
    handler: ({ part_number }, { signal }) =>
      client.get(
        `/stock/check-stock?${new URLSearchParams({ material: part_number })}`,
        stockResponse,
        signal,
      ),
  });
}
