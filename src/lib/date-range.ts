import "server-only";
import { cookies } from "next/headers";
import { RANGE_COOKIE, rangeInput, resolveDateRange, todayIn, type DateRange } from "./dates";

/** The page's date range: URL params, else the range the user last picked anywhere, else last 7 days. */
export async function pageDateRange(
  sp: Record<string, string | string[] | undefined>,
  timeZone: string,
): Promise<DateRange & { today: string }> {
  const jar = await cookies();
  return { ...resolveDateRange(rangeInput(sp, jar.get(RANGE_COOKIE)?.value), timeZone), today: todayIn(timeZone) };
}
