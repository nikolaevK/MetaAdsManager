import "server-only";
import { createHash } from "node:crypto";
import { graph } from "./client";

import type { PreviewFormat } from "./preview-formats";

export { PREVIEW_FORMATS, type PreviewFormat } from "./preview-formats";

const TTL_MS = 20 * 60_000;
const g = globalThis as unknown as { __previewCache?: Map<string, { src: string; at: number }> };
const cache = (g.__previewCache ??= new Map());

/** Extracts and validates the iframe src from the HTML snippet Meta returns. */
export function extractPreviewSrc(body: string): string {
  const m = body.match(/src="([^"]+)"/);
  if (!m) throw new Error("Meta returned a preview without an iframe");
  const src = m[1].replace(/&amp;/g, "&");
  const url = new URL(src);
  if (url.protocol !== "https:" || !(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))) {
    throw new Error("Unexpected preview host");
  }
  return url.toString();
}

/**
 * Real placement render via /generatepreviews using the same creative spec we send to /adcreatives,
 * so buyers see exactly what will launch.
 */
export async function generatePreview(
  adAccountId: string,
  creativeSpec: Record<string, unknown>,
  format: PreviewFormat,
): Promise<string> {
  const creative = {
    object_story_spec: creativeSpec.object_story_spec,
    asset_feed_spec: creativeSpec.asset_feed_spec,
    degrees_of_freedom_spec: creativeSpec.degrees_of_freedom_spec,
  };
  const key = createHash("sha256").update(JSON.stringify([adAccountId, creative, format])).digest("hex");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.src;

  const res = await graph<{ data: { body: string }[] }>(`${adAccountId}/generatepreviews`, {
    params: { creative, ad_format: format },
    accountId: adAccountId,
  });
  const body = res.data[0]?.body;
  if (!body) throw new Error("Meta returned no preview for this placement");
  const src = extractPreviewSrc(body);
  cache.set(key, { src, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return src;
}
