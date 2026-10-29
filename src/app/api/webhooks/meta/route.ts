import { createHmac, timingSafeEqual } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { adAccounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";

const REVIEW_FIELDS = new Set(["with_issues_ad_objects", "in_process_ad_objects"]);

/** Subscription handshake: Meta calls GET with hub.* params when the webhook is configured. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = env().META_WEBHOOK_VERIFY_TOKEN;
  if (
    token &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === token
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", secret).update(raw).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type WebhookBody = {
  object?: string;
  entry?: { id: string; changes?: { field: string; value?: unknown }[] }[];
};

/** Meta's deliveries are a few KB; anything far larger is refused before it is read into memory. */
const MAX_BODY_BYTES = 1_000_000;

/** Reads the body up to `max` bytes; null when it is larger. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Ad account review changes → immediate review sync (polling remains the fallback). */
export async function POST(request: Request): Promise<Response> {
  const secret = env().META_APP_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 503 });

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return new Response("Payload too large", { status: 413 });
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const ids = new Set<string>();
  for (const entry of body.entry ?? []) {
    if (entry.changes?.some((c) => REVIEW_FIELDS.has(c.field))) ids.add(`act_${entry.id.replace(/^act_/, "")}`);
  }
  if (ids.size > 0) {
    const connected = await db().select({ id: adAccounts.id }).from(adAccounts).where(inArray(adAccounts.id, [...ids]));
    for (const { id } of connected) {
      await enqueue("review.sync", { adAccountId: id }, { dedupeKey: `review:${id}`, priority: PRIORITY.review, adAccountId: id });
    }
    if (connected.length) kickWorker();
  }
  // Always 200 for valid deliveries so Meta doesn't retry/disable the subscription.
  return Response.json({ received: true });
}
