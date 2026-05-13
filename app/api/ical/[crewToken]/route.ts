import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { fetchProduction } from "@/lib/sheets";
import { buildCrewICal } from "@/lib/ical";

/**
 * Public iCalendar feed per crew. Bypasses auth (proxy.ts excludes
 * /api/ical) so subs can subscribe in their calendar app without
 * entering the dashboard password. Security via unguessable URL — the
 * token is a HMAC-SHA256 of the crew name signed with AUTH_SECRET, so
 * leaking one crew's URL doesn't expose another's, and brute-forcing
 * is infeasible.
 */

function tokenForCrew(crew: string): string {
  const secret = process.env.AUTH_SECRET || "fallback-dev-secret";
  return createHmac("sha256", secret).update(crew.toLowerCase()).digest("hex").slice(0, 32);
}

function crewFromToken(token: string, allCrews: string[]): string | null {
  for (const c of allCrews) {
    if (tokenForCrew(c) === token) return c;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ crewToken: string }> }
) {
  const { crewToken } = await params;
  try {
    const jobs = await fetchProduction();
    // Discover all crews from the live data
    const crewSet = new Set<string>();
    for (const j of jobs) {
      if (j.crew) crewSet.add(j.crew);
    }
    const crews = [...crewSet];
    const matched = crewFromToken(crewToken, crews);
    if (!matched) {
      return new NextResponse("Not found", { status: 404 });
    }
    const crewJobs = jobs.filter((j) => j.crew === matched);
    const baseUrl = req.nextUrl.origin;
    const ics = buildCrewICal(matched, crewJobs, baseUrl);
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="cc-${matched.toLowerCase().replace(/\s+/g, "-")}.ics"`,
        // Cache 15 min — calendar apps refetch on their own schedule
        "Cache-Control": "public, max-age=900, s-maxage=900",
      },
    });
  } catch (err) {
    console.error("ical fetch failed", err);
    return new NextResponse("Server error", { status: 500 });
  }
}

// Helper: compute and expose a token for a given crew name. Used by the
// drawer's "Subscribe in calendar" link.
export function GET_TOKEN(crew: string): string {
  return tokenForCrew(crew);
}
