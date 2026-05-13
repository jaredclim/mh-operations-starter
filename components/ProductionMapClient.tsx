"use client";

import dynamic from "next/dynamic";
import type { EstimatePoint, ProductionJob } from "@/lib/types";
import type { GeoCoord } from "@/lib/geocode";

// Leaflet uses window globals — must be client-side only. Wrapping the
// dynamic-import call in a client component lets us pass `ssr: false`
// (Next.js 16 disallows it from Server Components).
const ProductionMap = dynamic(
  () => import("@/components/ProductionMap").then((m) => m.ProductionMap),
  {
    ssr: false,
    loading: () => <div className="p-8 text-text-muted text-sm">Loading map…</div>,
  }
);

export function ProductionMapClient({
  jobs,
  estimates,
  geocodes,
}: {
  jobs: ProductionJob[];
  estimates: EstimatePoint[];
  geocodes: Record<string, GeoCoord>;
}) {
  return <ProductionMap jobs={jobs} estimates={estimates} geocodes={geocodes} />;
}
