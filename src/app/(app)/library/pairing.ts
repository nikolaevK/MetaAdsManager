/** Pure helpers for pairing 1:1 / 9:16 assets into creatives by file name (unit-testable). */

export const SQUARE_ASPECTS = new Set(["1:1", "4:5"]);
export const VERTICAL_ASPECTS = new Set(["9:16"]);

// Ratio / placement words that differ between the two files of a pair.
const VARIANT_TOKENS =
  /(^|[\s._-])(\d{3,4}x\d{3,4}|1x1|4x5|9x16|1-1|4-5|9-16|square|sq|feed|vertical|vert|story|stories|reels?)(?=$|[\s._-])/gi;

/** Display name for the pair: file name without extension and variant tokens. */
export function baseName(fileName: string): string {
  const noExt = fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  let prev = "";
  let out = noExt;
  // Tokens can be adjacent ("ad_1x1_feed"), so strip until stable.
  while (out !== prev) {
    prev = out;
    out = out.replace(VARIANT_TOKENS, "$1");
  }
  return out.replace(/[\s._-]+/g, " ").trim() || noExt;
}

/** Grouping key: case- and separator-insensitive. */
export function pairKey(fileName: string): string {
  return baseName(fileName).toLowerCase().replace(/\s+/g, " ");
}

type PairableAsset = { id: string; kind: string; aspect: string; fileName: string };

/** Groups that contain exactly one square and exactly one vertical asset of the same kind. */
export function findPairs<T extends PairableAsset>(assets: T[]): { name: string; square: T; vertical: T }[] {
  const groups = new Map<string, T[]>();
  for (const a of assets) {
    const key = `${a.kind}:${pairKey(a.fileName)}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const pairs: { name: string; square: T; vertical: T }[] = [];
  for (const list of groups.values()) {
    const squares = list.filter((a) => SQUARE_ASPECTS.has(a.aspect));
    const verticals = list.filter((a) => VERTICAL_ASPECTS.has(a.aspect));
    if (squares.length === 1 && verticals.length === 1) {
      pairs.push({ name: baseName(squares[0].fileName), square: squares[0], vertical: verticals[0] });
    }
  }
  return pairs;
}
