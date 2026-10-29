// Error codes Meta documents as throttling: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const TRANSIENT_CODES = new Set([1, 2]);

export type MetaErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  is_transient?: boolean;
};

export class MetaApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly fbtraceId?: string;
  readonly userTitle?: string;
  readonly userMessage?: string;
  readonly isRateLimit: boolean;
  readonly isTransient: boolean;
  /** Suggested wait before retrying, when Meta told us. */
  retryAfterMs?: number;

  constructor(status: number, body: MetaErrorBody | undefined) {
    const msg = body?.error_user_msg || body?.message || `Meta API request failed (${status})`;
    super(msg);
    this.name = "MetaApiError";
    this.status = status;
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.fbtraceId = body?.fbtrace_id;
    this.userTitle = body?.error_user_title;
    this.userMessage = body?.error_user_msg;
    this.isRateLimit = body?.code !== undefined && RATE_LIMIT_CODES.has(body.code);
    this.isTransient =
      this.isRateLimit ||
      body?.is_transient === true ||
      (body?.code !== undefined && TRANSIENT_CODES.has(body.code)) ||
      status >= 500 ||
      status === 429;
  }

  /** Short, user-presentable description. */
  get display(): string {
    const head = this.userTitle ? `${this.userTitle}: ` : "";
    const code = this.code !== undefined ? ` (code ${this.code}${this.subcode ? `/${this.subcode}` : ""})` : "";
    return `${head}${this.message}${code}`;
  }
}

/** Thrown before a call is made when our own usage tracking says the bucket is exhausted. */
export class RateLimitedError extends Error {
  constructor(
    readonly retryAt: number,
    readonly bucket: string,
  ) {
    super(`Meta rate limit reached for ${bucket}; retry after ${new Date(retryAt).toISOString()}`);
    this.name = "RateLimitedError";
  }
}

export function isTransient(err: unknown): boolean {
  if (err instanceof RateLimitedError) return true;
  if (err instanceof MetaApiError) return err.isTransient;
  // fetch() rejects with TypeError("fetch failed", { cause }) on network errors; timeouts are DOMExceptions.
  if (err instanceof DOMException) return err.name === "TimeoutError" || err.name === "AbortError";
  return err instanceof TypeError && (err.message === "fetch failed" || err.cause !== undefined);
}

export function errorMessage(err: unknown): string {
  if (err instanceof MetaApiError) return err.display;
  if (err instanceof Error) return err.message;
  return String(err);
}
