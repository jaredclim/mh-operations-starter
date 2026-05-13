import type { Metadata } from "next";
import { fetchCrewData, fetchProduction } from "@/lib/sheets";
import { fetchWeatherForecast, type DayWeather } from "@/lib/weather";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { Nav } from "@/components/Nav";
import { RefreshButton } from "@/components/RefreshButton";
import { OverflowMenu } from "@/components/OverflowMenu";

export const metadata: Metadata = { title: "Production" };
// NOTE: ConfirmationBanner shelved 2026-05-10 — CC doesn't promise dates
// to clients until a few days before the job, so a 72hr-out "confirming
// your painting" email is premature. Schema (AF Auto-Confirm + AG
// Confirmation Sent Date) + code (lib/clientConfirmation.ts +
// components/ConfirmationBanner.tsx) preserved for the eventual
// pre-production communication sequence redesign. Re-import + remount
// below when that lands.
// import { ConfirmationBanner } from "@/components/ConfirmationBanner";

export const revalidate = 300;

async function getData() {
  try {
    // Fetch jobs + weather in parallel — both server-side, both cached.
    const [jobs, weatherMap, crewData] = await Promise.all([
      fetchProduction(),
      fetchWeatherForecast(),
      fetchCrewData(),
    ]);
    const weather: Record<string, DayWeather> = {};
    for (const [k, v] of weatherMap.entries()) weather[k] = v;
    return { jobs, weather, crewData, error: null as string | null };
  } catch (err: unknown) {
    return {
      jobs: null,
      weather: {},
      crewData: { manualCrews: [], blocks: {} },
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export default async function ProductionPage() {
  const { jobs, weather, crewData, error } = await getData();

  return (
    <main className="min-h-screen bg-bg">
      <header className="bg-cc-navy text-white border-b border-cc-navy-deep sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Real CC logo (transparent PNG sourced from brand assets).
                White-bg tile keeps it legible against the navy header. */}
            <div className="h-10 px-2 rounded-lg bg-white/95 flex items-center justify-center shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/cc-logo.png"
                alt="Colour Craft"
                className="h-7 w-auto object-contain"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-cc-accent/90 font-semibold">
                Colour Craft
              </div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">Production</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Nav />
            <RefreshButton />
            <OverflowMenu />
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-cc-danger">
            <div className="font-semibold mb-1">Couldn&apos;t load production data</div>
            <div className="text-text-secondary">{error}</div>
          </div>
        )}
        {jobs && (
          <ProductionTimeline
            jobs={jobs}
            weather={weather}
            initialManualCrews={crewData.manualCrews}
            initialBlocks={crewData.blocks}
          />
        )}
      </div>
    </main>
  );
}
