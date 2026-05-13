import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Next.js 16: middleware file is named proxy.ts and exports `proxy()`.
// This intercepts every request, redirecting unauthenticated users to /login.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|manifest.webmanifest).*)",
  ],
};

export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return redirectToLogin(req);
  const ok = await verifySessionToken(cookie.value);
  if (!ok) return redirectToLogin(req);
  return NextResponse.next();
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
