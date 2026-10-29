// Error codes Meta documents as throttling: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const TRANSIENT_CODES = new Set([1, 2]);
/**
 * Throttling codes that aren't about call volume: "changed too often" limits that last an hour or a day (retrying
 * can't help, and they mustn't block the whole account), and one object edited twice within 30 seconds.
 */
const NOT_A_RATE_LIMIT = new Set(["613/1487632", "17/1885172", "613/1487225", "613/4841018"]);
const SAME_OBJECT_EDIT = "613/4841018";

/** What to do about errors whose own message doesn't say. Keyed "code/subcode", "subcode" or "code". */
const HINTS: Record<string, string> = {
  "1885183": "Your Meta app is in Development mode: switch it to Live (developers.facebook.com → App Mode), then retry.",
  "1487390": "Meta's generic creative error. It often hides the Meta app being in Development mode, or a Page or Instagram permission problem.",
  "190": "The Meta access token is invalid or expired: create a new system-user token and update META_ACCESS_TOKEN.",
  "10": "The Meta app or system user lacks permission for this; check the app's access level and the system user's assets.",
  "200": "The system user isn't assigned to this asset (ad account, Page, pixel or Instagram account) with the needed task. Assign it in Business Settings.",
  "100/33": "Meta can't find this object, or the system user can't see it.",
  "3858079": "Ads that reach the EU need a payer (DSA): fill in “Paid for by” on the ad set, or set the ad account's default.",
  "3858081": "Ads that reach the EU need a beneficiary (DSA): fill in “Beneficiary” on the ad set, or set the ad account's default.",
  "3858152": "This ad's ad set reaches the EU and needs DSA beneficiary and payer details.",
  "1815199": "This ad account can't use that Instagram account: assign it to the ad account in Business Settings, or run the ads as the Page.",
  "2446307": "The campaign spending limit is below Meta's minimum for this account.",
  "1885272": "The budget is below Meta's minimum for this goal; raise it.",
  "1885650": "The budget is below Meta's minimum for this goal; raise it.",
  "1885621": "Set the budget on the campaign or on its ad sets, not both.",
  "2446509": "That conversion location isn't available for the campaign's objective.",
  "1487694": "A detailed-targeting option is no longer available; remove it and search again.",
  "2446394": "A detailed-targeting option is unavailable or can't be excluded; remove it.",
  "1870199": "Meta only targets people who live in or were recently in a location; remove other location types.",
  "1885878": "With a separate Stories & Reels file, Meta allows one primary text and one headline.",
  "613/4841018": "This object was changed moments ago; wait 30 seconds and try again.",
  "613/1487632": "An ad set's budget can be changed 4 times an hour; try again later.",
  "17/1885172": "The account spending limit can be changed 10 times a day; try again tomorrow.",
  "613/1487225": "The ad account reached its ad limit: archive old ads or raise the daily spending limit.",
  "368": "Meta temporarily blocked this as unusual activity; slow down and check Account Quality.",
  "2490427": "This ad was rejected and disabled; create a new ad instead.",
  "2490468": "This ad was rejected and disabled; create a new ad instead.",
  "1885029": "The ad's Page doesn't match the ad set's Page.",
  "1487472": "That post can't be used in an ad (deleted, private or not eligible).",
  "2446289": "That post can't be used in an ad (deleted, private or not eligible).",
  "2446880": "The WhatsApp number connected to the Page was disconnected; reconnect it.",
};

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
    const key = `${body?.code}/${body?.error_subcode}`;
    this.isRateLimit = body?.code !== undefined && RATE_LIMIT_CODES.has(body.code) && !NOT_A_RATE_LIMIT.has(key);
    this.isTransient =
      this.isRateLimit ||
      key === SAME_OBJECT_EDIT ||
      body?.is_transient === true ||
      (body?.code !== undefined && TRANSIENT_CODES.has(body.code)) ||
      body?.error_subcode === 3910001 ||
      (!NOT_A_RATE_LIMIT.has(key) && (status >= 500 || status === 429));
    // Meta allows one edit per object every 30 seconds.
    if (key === SAME_OBJECT_EDIT) this.retryAfterMs = 30_000;
  }

  /** What the user can do about it, when the error is a known one. */
  get hint(): string | undefined {
    return HINTS[`${this.code}/${this.subcode}`] ?? (this.subcode !== undefined ? HINTS[String(this.subcode)] : undefined) ?? HINTS[String(this.code)];
  }

  /** Short, user-presentable description. */
  get display(): string {
    const head = this.userTitle ? `${this.userTitle}: ` : "";
    const code = this.code !== undefined ? ` (code ${this.code}${this.subcode ? `/${this.subcode}` : ""})` : "";
    const hint = this.hint;
    return `${head}${this.message}${code}${hint ? ` ${hint}` : ""}`;
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

/** Node / undici network error codes that mean "try again later". */
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH"]);
/** libSQL / Turso codes for a busy database or a dropped connection. */
const DB_RETRY_CODES = new Set(["SQLITE_BUSY", "SQLITE_LOCKED", "SERVER_ERROR", "HRANA_WEBSOCKET_ERROR", "HRANA_CLOSED_ERROR", "STREAM_EXPIRED"]);

export function isTransient(err: unknown): boolean {
  // Drizzle wraps driver errors (DrizzleQueryError → LibsqlError, or TypeError "fetch failed" → ConnectTimeoutError),
  // so a database or network blip is only recognisable further down the cause chain.
  for (let e = err, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof RateLimitedError) return true;
    if (e instanceof MetaApiError) return e.isTransient;
    // fetch() rejects with TypeError("fetch failed", { cause }) on network errors; timeouts are DOMExceptions.
    if (e instanceof DOMException) return e.name === "TimeoutError" || e.name === "AbortError";
    if (e instanceof TypeError && e.message === "fetch failed") return true;
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && (NETWORK_CODES.has(code) || DB_RETRY_CODES.has(code) || code.startsWith("UND_ERR_"))) return true;
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof MetaApiError) return err.display;
  if (err instanceof Error) return err.message;
  return String(err);
}
