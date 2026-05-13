import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

/**
 * Returns the iCal subscription URL for a given crew name. Authed
 * (the proxy gate covers this path) so non-logged-in callers can't
 * enumerate all crews' subscription URLs by guessing names.
 */
export async function GET(req: NextRequest) {
  const crew = req.nextUrl.searchParams.get("crew");
  if (!crew) {
    return NextResponse.json({ error: "crew query param required" }, { status: 400 });
  }
  const secret = process.env.AUTH_SECRET || "fallback-dev-secret";
  const token = createHmac("sha256", secret)
    .update(crew.toLowerCase())
    .digest("hex")
    .slice(0, 32);
  const url = `${req.nextUrl.origin}/api/ical/${token}`;
  return NextResponse.json({ crew, token, url });
}
