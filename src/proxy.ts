import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "mam_session";
const SESSION_TTL_S = 60 * 60 * 24 * 7;

// Optimistic check only (cookie presence). Every page, action and route handler re-validates the
// session against the database before touching data.
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  // Server Components can't write cookies, so keep the cookie alive here while the user is active.
  // Harmless for stale tokens: the DB session (with its own sliding expiry) is what gets checked.
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return res;
}

export const config = {
  // API routes authenticate themselves (cron secret, webhook signature, session).
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
