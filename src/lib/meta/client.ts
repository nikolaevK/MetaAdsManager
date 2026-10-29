import "server-only";
import { createHmac } from "node:crypto";
import { env, requireMetaToken } from "@/lib/env";
import { MetaApiError, type MetaErrorBody } from "./errors";
import { gate, recordThrottle, recordUsage, type CallMode } from "./rate-limit";
import { parseUsageHeaders } from "./usage-headers";

export type Params = Record<string, unknown>;

export type GraphOptions = {
  method?: "GET" | "POST" | "DELETE";
  params?: Params;
  /** Multipart body (file uploads). Params are still sent in the query string. */
  form?: FormData;
  /** Ad account the call is attributed to, for rate-limit tracking. */
  accountId?: string;
  mode?: CallMode;
  timeoutMs?: number;
  /** Video uploads go to graph-video.facebook.com. */
  host?: "graph" | "video";
  /** A Page access token for Page-scoped edges (e.g. lead forms); defaults to the system-user token. Never logged or stored. */
  token?: string;
};

const VIDEO_BASE = "https://graph-video.facebook.com";
const BASE = "https://graph.facebook.com";
const DEFAULT_THROTTLE_BACKOFF_MS = 5 * 60_000;

/**
 * META_GRAPH_BASE_URL points calls at a local mock for testing. The real token would be sent to it too, so it's
 * ignored in production and limited to loopback hosts.
 */
function mockBase(): string | undefined {
  const url = env().META_GRAPH_BASE_URL;
  if (!url || process.env.NODE_ENV === "production") return undefined;
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? url : undefined;
}

function appsecretProof(token: string): string | undefined {
  const secret = env().META_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : undefined;
}

/** Graph API expects nested values JSON-encoded. */
export function encodeParams(params: Params = {}): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return out;
}

async function send(path: string, opts: GraphOptions): Promise<Response> {
  const token = opts.token ?? requireMetaToken();
  const method = opts.method ?? "GET";
  const base = mockBase() ?? (opts.host === "video" ? VIDEO_BASE : BASE);
  const url = new URL(`${base}/${env().META_API_VERSION}/${path.replace(/^\//, "")}`);
  const proof = appsecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);

  let body: BodyInit | undefined;
  if (opts.form) {
    for (const [k, v] of encodeParams(opts.params)) url.searchParams.set(k, v);
    body = opts.form;
  } else if (method === "GET") {
    for (const [k, v] of encodeParams(opts.params)) url.searchParams.set(k, v);
  } else {
    body = encodeParams(opts.params);
  }

  return fetch(url, {
    method,
    body,
    // Token in a header keeps it out of URLs (and therefore out of proxy/access logs).
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    cache: "no-store",
  });
}

async function handleUsage(res: Response, accountId?: string) {
  const usage = parseUsageHeaders(res.headers);
  if (usage.app || usage.account) {
    const raw = res.headers.get("x-business-use-case-usage") ?? res.headers.get("x-ad-account-usage") ?? undefined;
    await recordUsage(accountId, usage, raw ?? undefined);
  }
  return usage;
}

/** Single Graph API call with rate-limit gating, usage tracking and typed errors. */
export async function graph<T = unknown>(path: string, opts: GraphOptions = {}): Promise<T> {
  await gate(opts.accountId, opts.mode ?? "interactive");
  const res = await send(path, opts);
  const usage = await handleUsage(res, opts.accountId);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaApiError(res.status, { message: `Non-JSON response from Meta: ${text.slice(0, 200)}` });
  }
  const errBody = (data as { error?: MetaErrorBody }).error;
  if (!res.ok || errBody) {
    const err = new MetaApiError(res.status, errBody);
    if (err.isRateLimit) {
      err.retryAfterMs = Math.max(
        (usage.account?.regainAt ?? 0) - Date.now(),
        (usage.app?.regainAt ?? 0) - Date.now(),
        DEFAULT_THROTTLE_BACKOFF_MS,
      );
      // 4 = app limit, 17/32 = token (user/page) limit, except 17/2446079 which is per ad account.
      const appWide = err.code === 4 || err.code === 32 || (err.code === 17 && err.subcode !== 2446079);
      await recordThrottle(appWide ? undefined : opts.accountId, err.retryAfterMs);
    }
    throw err;
  }
  return data as T;
}

type Page<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } };

/**
 * Follows cursor pagination. Throws rather than returning a silently truncated list when the page
 * cap is hit: callers (structure/insights sync) replace whole windows with what this returns.
 */
export async function graphAll<T>(path: string, opts: GraphOptions & { maxPages?: number } = {}): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  const maxPages = opts.maxPages ?? 200;
  for (let page = 0; page < maxPages; page++) {
    const res = await graph<Page<T>>(path, { ...opts, params: { ...opts.params, after } });
    out.push(...res.data);
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) return out;
  }
  throw new Error(`${path}: more than ${maxPages} pages of results; refusing to return a partial list`);
}

// ── Batch API ────────────────────────────────────────────────────────────────

export type BatchRequest = {
  method: "GET" | "POST" | "DELETE";
  /** Relative to the version root, e.g. "act_123/ads" or "1234?fields=id". */
  relativeUrl: string;
  params?: Params;
  /** Name for JSONPath references between requests: "{result=name:$.id}". */
  name?: string;
};

export type BatchResult<T = unknown> = { ok: true; data: T } | { ok: false; error: MetaApiError };

const BATCH_LIMIT = 50;

/**
 * Graph batch requests (≤50 per HTTP call). Each sub-request succeeds or fails independently;
 * callers decide how to handle partial failure.
 */
export async function graphBatch<T = unknown>(
  requests: BatchRequest[],
  opts: Pick<GraphOptions, "accountId" | "mode"> = {},
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = [];
  for (let i = 0; i < requests.length; i += BATCH_LIMIT) {
    const chunk = requests.slice(i, i + BATCH_LIMIT);
    const batch = chunk.map((r) => ({
      method: r.method,
      relative_url: r.relativeUrl,
      ...(r.name ? { name: r.name, omit_response_on_success: false } : {}),
      ...(r.params && r.method !== "GET" ? { body: encodeParams(r.params).toString() } : {}),
    }));
    const raw = await graph<({ code: number; body: string } | null)[]>("", {
      method: "POST",
      params: { batch, include_headers: false },
      accountId: opts.accountId,
      mode: opts.mode,
      timeoutMs: 120_000,
    });
    for (const item of raw) {
      if (!item) {
        // Meta returns null for items it didn't finish ("partially completed batch, retry"): transient.
        results.push({ ok: false, error: new MetaApiError(0, { message: "Batch item not completed by Meta", is_transient: true }) });
        continue;
      }
      let body: unknown;
      try {
        body = item.body ? JSON.parse(item.body) : {};
      } catch {
        body = {};
      }
      const errBody = (body as { error?: MetaErrorBody }).error;
      if (item.code >= 400 || errBody) results.push({ ok: false, error: new MetaApiError(item.code, errBody) });
      else results.push({ ok: true, data: body as T });
    }
  }
  return results;
}

const UPDATE_RETRY_MS = [1_500, 4_000];

/**
 * graphBatch for idempotent updates (status, budget, name): items that failed with a temporary Meta error
 * (code 1/2, or left unfinished by Meta) are sent again, up to twice. Never use it for creates.
 */
export async function graphBatchUpdate<T = unknown>(
  requests: BatchRequest[],
  opts: Pick<GraphOptions, "accountId" | "mode"> = {},
): Promise<BatchResult<T>[]> {
  const results = await graphBatch<T>(requests, opts);
  for (const wait of UPDATE_RETRY_MS) {
    const again = results.flatMap((r, k) => (!r.ok && r.error.isTransient && !r.error.isRateLimit ? [k] : []));
    if (again.length === 0) break;
    await new Promise((r) => setTimeout(r, wait));
    const retried = await graphBatch<T>(again.map((k) => requests[k]), opts);
    again.forEach((k, i) => (results[k] = retried[i]));
  }
  return results;
}

export const normalizeAccountId = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);
