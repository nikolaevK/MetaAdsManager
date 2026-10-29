/** Pure transforms behind the bulk edit dialog (unit tested). */

export type BudgetOp = { mode: "set" | "increase" | "decrease"; unit: "amount" | "percent"; value: number };
export type NameOp = { mode: "prefix" | "suffix" | "replace"; text: string; find?: string; caseSensitive?: boolean };

/** New budget in major units, rounded to cents and never below `min`. Null when the op is a no-op/invalid. */
export function applyBudgetOp(current: number, op: BudgetOp, min = 1): number | null {
  if (!(op.value > 0)) return null;
  let next: number;
  if (op.mode === "set") next = op.unit === "percent" ? (current * op.value) / 100 : op.value;
  else {
    const delta = op.unit === "percent" ? (current * op.value) / 100 : op.value;
    next = op.mode === "increase" ? current + delta : current - delta;
  }
  next = Math.round(next * 100) / 100;
  if (next < min) next = min;
  return next === current ? null : next;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** New name, or null when unchanged or empty. */
export function applyNameOp(name: string, op: NameOp): string | null {
  let next = name;
  if (op.mode === "prefix") next = `${op.text}${name}`;
  else if (op.mode === "suffix") next = `${name}${op.text}`;
  else if (op.find) next = name.replace(new RegExp(escapeRe(op.find), op.caseSensitive ? "g" : "gi"), op.text);
  next = next.trim().slice(0, 400);
  return next && next !== name ? next : null;
}
