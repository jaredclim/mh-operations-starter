import { NextRequest, NextResponse } from "next/server";
import { fetchActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId") ?? undefined;
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 500) : 50;
  try {
    const entries = await fetchActivity({ jobId: jobId || undefined, limit });
    return NextResponse.json({ entries });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg, entries: [] }, { status: 500 });
  }
}
