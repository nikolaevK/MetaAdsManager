/** Naming conventions: patterns like "{client} | {objective} | {date}" rendered per level. */

export const NAMING_TOKENS = {
  campaign: ["client", "account", "template", "objective", "event", "budget", "label", "date"],
  adset: ["client", "template", "objective", "event", "budget", "label", "date", "geo", "age", "audience", "index"],
  ad: ["client", "label", "date", "creative", "angle", "format", "index"],
} as const;

export const DEFAULT_NAMING = {
  campaignPattern: "{client} | {objective} | {budget} | {label} | {date}",
  adsetPattern: "{geo} | {age} | {audience} | {index}",
  adPattern: "{creative} | {format} | {angle}",
};

export type NamingValues = Partial<Record<string, string | number | undefined>>;

/**
 * Replaces {token} with its value. Empty values drop the token and one adjacent separator so
 * "{a} | {b} | {c}" with an empty b renders "A | C". Unknown tokens are kept verbatim so
 * typos are visible in the preview rather than silently disappearing.
 */
export function renderName(pattern: string, values: NamingValues): string {
  // Even indices are literals, odd indices are {tokens}.
  const segs = pattern.split(/(\{[a-z_]+\})/g).map((part, i) => {
    if (i % 2 === 0) return part;
    const key = part.slice(1, -1);
    if (!(key in values)) return part;
    const v = values[key];
    return v === undefined || v === null ? "" : String(v).trim();
  });
  const isSeparator = (s: string) => /^\s*[|_\-/·,]\s*$/.test(s);
  for (let i = 1; i < segs.length; i += 2) {
    if (segs[i] !== "") continue;
    if (i - 1 > 0 && isSeparator(segs[i - 1])) segs[i - 1] = "";
    else if (i + 1 < segs.length && isSeparator(segs[i + 1])) segs[i + 1] = "";
  }
  return segs
    .join("")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|_\-/·,]+|[\s|_\-/·,]+$/g, "")
    .slice(0, 400);
}

export function formatDateToken(d = new Date()): string {
  const y = d.getFullYear() % 100;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${String(y).padStart(2, "0")}${String(m).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

const OBJECTIVE_LABEL: Record<string, string> = { OUTCOME_SALES: "Sales", OUTCOME_LEADS: "Leads" };
export const objectiveLabel = (o: string) => OBJECTIVE_LABEL[o] ?? o;

export function ageToken(min: number, max: number): string {
  return max >= 65 ? `${min}-65+` : `${min}-${max}`;
}
