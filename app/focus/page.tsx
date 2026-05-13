import type { Metadata } from "next";
import { fetchOpportunities, fetchArchive } from "@/lib/sheets";
import { bucketize } from "@/lib/bucketing";
import { buildFocusQueue, type FocusScope } from "@/lib/focusQueue";
import { FocusModeView } from "@/components/FocusModeView";
import { todayISO } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = { title: "Focus" };

// Focus Mode is a live "play through your day" surface — don't cache
// statically. ISR 60s so the queue stays current if Jared opens it
// after a break, but a refresh inside the session re-fetches fresh.
export const revalidate = 60;

async function getData() {
  try {
    const [opps, archive] = await Promise.all([fetchOpportunities(), fetchArchive()]);
    return { data: bucketize(opps, archive), error: null as string | null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export default async function FocusPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const scopeRaw = params.scope;
  const scope: FocusScope =
    scopeRaw === "top25" || scopeRaw === "verbal-yes" || scopeRaw === "all-overdue"
      ? scopeRaw
      : "today";

  const { data, error } = await getData();
  const today = todayISO();
  const queue = data ? buildFocusQueue(data.active, { today, scope }) : [];

  return (
    <main className="min-h-screen bg-bg text-text-primary relative">
      {/* Top bar — navy band to anchor the page like the other dashboards */}
      <header className="bg-cc-navy text-white border-b border-cc-navy-deep">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Pipeline
          </Link>
          <div className="text-[10px] uppercase tracking-[0.25em] text-cc-accent font-semibold">
            Focus Mode
          </div>
          <div className="w-[120px]" />
        </div>
      </header>

      {error && (
        <div className="max-w-2xl mx-auto mt-10 p-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-sm">
          {error}
        </div>
      )}

      {!error && data && (
        <FocusModeView initialQueue={queue} scope={scope} today={today} />
      )}
    </main>
  );
}
