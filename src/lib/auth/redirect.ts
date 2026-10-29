/**
 * Only same-site paths are allowed as post-login destinations. Parsing (rather than prefix checks) catches
 * tricks like "/\t/evil.example": browsers drop tabs and newlines, which would turn it into "//evil.example".
 */
export function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || /[\u0000-\u001f\\]/.test(next)) return "/campaigns";
  try {
    const url = new URL(next, "http://same.invalid");
    return url.origin === "http://same.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/campaigns";
  } catch {
    return "/campaigns";
  }
}
