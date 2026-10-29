/** Pure parsing of Meta's rate-limit usage headers (unit tested). */

export type UsageReading = {
  /** Highest utilisation percentage across the bucket's dimensions. */
  pct: number;
  /** Epoch ms when Meta says access returns, if currently throttled. */
  regainAt: number | null;
};

export type ParsedUsage = {
  app?: UsageReading;
  account?: UsageReading;
};

function json(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function maxReading(a: UsageReading | undefined, b: UsageReading | undefined): UsageReading | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    pct: Math.max(a.pct, b.pct),
    regainAt: a.regainAt && b.regainAt ? Math.max(a.regainAt, b.regainAt) : (a.regainAt ?? b.regainAt),
  };
}

export function parseUsageHeaders(headers: Headers, now = Date.now()): ParsedUsage {
  const result: ParsedUsage = {};

  // x-app-usage: {"call_count":28,"total_time":25,"total_cputime":25}
  const app = json(headers.get("x-app-usage")) as Record<string, unknown> | undefined;
  if (app) {
    result.app = { pct: Math.max(num(app.call_count), num(app.total_time), num(app.total_cputime)), regainAt: null };
  }

  // x-ad-account-usage: {"acc_id_util_pct":9.67,"reset_time_duration":0,"ads_api_access_tier":"standard_access"}
  const acct = json(headers.get("x-ad-account-usage")) as Record<string, unknown> | undefined;
  if (acct) {
    const pct = num(acct.acc_id_util_pct);
    const reset = num(acct.reset_time_duration);
    result.account = maxReading(result.account, { pct, regainAt: pct >= 100 && reset > 0 ? now + reset * 1000 : null });
  }

  // x-fb-ads-insights-throttle: {"app_id_util_pct":0,"acc_id_util_pct":0}
  const insights = json(headers.get("x-fb-ads-insights-throttle")) as Record<string, unknown> | undefined;
  if (insights) {
    result.account = maxReading(result.account, {
      pct: Math.max(num(insights.acc_id_util_pct), num(insights.app_id_util_pct)),
      regainAt: null,
    });
  }

  // x-business-use-case-usage: {"<business_id>":[{"type":"ads_management","call_count":95,"total_cputime":20,
  //   "total_time":20,"estimated_time_to_regain_access":3}]}   (regain time is in MINUTES)
  const buc = json(headers.get("x-business-use-case-usage")) as Record<string, unknown> | undefined;
  if (buc && typeof buc === "object") {
    for (const entries of Object.values(buc)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries as Record<string, unknown>[]) {
        const minutes = num(e.estimated_time_to_regain_access);
        result.account = maxReading(result.account, {
          pct: Math.max(num(e.call_count), num(e.total_time), num(e.total_cputime)),
          regainAt: minutes > 0 ? now + minutes * 60_000 : null,
        });
      }
    }
  }

  return result;
}
