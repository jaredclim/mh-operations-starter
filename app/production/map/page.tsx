import type { Metadata } from "next";
import { fetchProduction, fetchEstimatePoints } from "@/lib/sheets";
import { resolveGeocodes, type GeoCoord } from "@/lib/geocode";
import { Nav } from "@/components/Nav";
import { RefreshButton } from "@/components/RefreshButton";
import { OverflowMenu } from "@/components/OverflowMenu";
import { ProductionMapClient } from "@/components/ProductionMapClient";
import type { EstimatePoint, ProductionJob } from "@/lib/types";

export const metadata: Metadata = { title: "Map" };
export const revalidate = 300;

async function getData(): Promise<{
  jobs: ProductionJob[] | null;
  estimates: EstimatePoint[];
  geocodes: Record<string, GeoCoord>;
  error: string | null;
}> {
  try {
    const [jobs, estimates] = await Promise.all([fetchProduction(), fetchEstimatePoints()]);
    // Geocode the union of every address we plan to render so a single
    // cache lookup covers booked jobs + estimates without redundant work.
    const addresses = [
      ...jobs.map((j) => j.address),
      ...estimates.map((e) => e.address),
    ].filter((a) => a && a.trim());
    const geocodes = await resolveGeocodes(addresses);
    return { jobs, estimates, geocodes, error: null };
  } catch (err: unknown) {
    return {
      jobs: null,
      estimates: [],
      geocodes: {} as Record<string, GeoCoord>,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export default async function ProductionMapPage() {
  const { jobs, estimates, geocodes, error } = await getData();

  return (
    <main className="min-h-screen bg-bg">
      <header className="bg-cc-navy text-white border-b border-cc-navy-deep sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 px-2 rounded-lg bg-white/95 flex items-center justify-center shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cc-logo.png" alt="Colour Craft" className="h-7 w-auto object-contain" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-cc-accent/90 font-semibold">
                Colour Craft
              </div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">Map</h1>
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
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-cc-danger mb-4">
            <div className="font-semibold mb-1">Couldn&apos;t load map data</div>
            <div className="text-text-secondary">{error}</div>
          </div>
        )}
        {jobs && (
          <ProductionMapClient
            jobs={jobs}
            estimates={estimates}
            geocodes={geocodes}
          />
        )}
      </div>
    </main>
  );
}
