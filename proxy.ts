import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const config = {
  matcher: [
    // Run on all paths except static assets, login + auth API, and the
    // public iCal feed (subs need to subscribe without entering a
    // password — security via unguessable token URL instead).
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/ical|manifest.webmanifest|sw.js|icons|cc-logo).*)",
  ],
};

export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  const ok = await verifySessionToken(cookie.value);
  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
