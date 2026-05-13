"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn, effectiveStatus, formatCurrency } from "@/lib/utils";
import type { EstimatePoint, ProductionJob } from "@/lib/types";
import type { GeoCoord } from "@/lib/geocode";

// Fix Leaflet's default marker images (they don't ship with proper
// asset paths in bundlers). Replace with CSS-only colored circle markers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;

interface Props {
  jobs: ProductionJob[];
  estimates: EstimatePoint[];
  geocodes: Record<string, GeoCoord>;
}

// Crew color palette — same accent used across the dashboard for
// each named crew. Generates a stable color from the crew name so new
// crews automatically get a distinct color without configuration.
function colorForCrew(crew: string): string {
  if (!crew) return "#9ca3af"; // zinc-400 for Unassigned
  // Hash the crew name to pick from a curated palette of distinguishable colors
  const palette = [
    "#0F2D4A", // cc navy
    "#F19E3D", // cc accent (orange)
    "#10b981", // emerald
    "#a855f7", // violet
    "#ef4444", // rose
    "#0ea5e9", // sky
    "#f59e0b", // amber
    "#14b8a6", // teal
    "#ec4899", // pink
  ];
  let hash = 0;
  for (let i = 0; i < crew.length; i++) {
    hash = (hash * 31 + crew.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

function makeJobIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "cc-job-pin",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="
      background:${color};
      width:26px; height:26px; border-radius:50%;
      border:3px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);
      color:white; font-weight:700; font-size:10px;
      display:flex; align-items:center; justify-content:center;
      ">${label}</div>`,
  });
}

// Estimate pins are visually subordinate to booked-job pins so density
// patterns read at a glance without estimates overwhelming the booked
// signal. Smaller, lighter fill, thinner border, slightly lower opacity.
// Color hints at stage: lost = neutral gray, active stages = warm amber,
// long-term = cool blue.
function colorForEstimateStage(stage: string): string {
  if (stage === "Lost") return "#94a3b8"; // slate-400 — closed, neutral
  if (stage === "Won") return "#16a34a"; // green-600 — booked/closed-win (archive)
  if (stage === "Long-Term") return "#0ea5e9"; // sky — future
  if (stage === "On Hold") return "#a855f7"; // violet — paused
  if (stage === "Verbal Yes") return "#10b981"; // emerald — hot
  return "#F19E3D"; // cc accent (orange) for Proposal Sent + default active
}

function makeEstimateIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "cc-estimate-pin",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="
      background:${color};
      width:14px; height:14px; border-radius:50%;
      border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.3);
      opacity:0.9;
      "></div>`,
  });
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase().replace(/\s+/g, " ");
}

// Fit-bounds helper component — runs once on mount to zoom the map to
// fit all visible job pins.
function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  if (bounds) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  return null;
}

// Year extraction for a pin — pick the most representative date from
// whatever fields are populated. For estimates: estDate > proposalDate >
// resultDate. For booked jobs: startDate. Returns null when none.
function yearForEstimate(e: EstimatePoint): number | null {
  const src = e.estDate || e.proposalDate || e.resultDate || "";
  const m = src.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
function yearForJob(j: ProductionJob): number | null {
  const src = j.startDate || j.endDate || "";
  const m = src.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

export function ProductionMap({ jobs, estimates, geocodes }: Props) {
  const [filterCrew, setFilterCrew] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "in-progress">("active");
  // Layer toggles — booked jobs default on (preserves the original map
  // behavior), estimates default off (Jared opts in when he wants the
  // marketing/territory lens).
  const [showBooked, setShowBooked] = useState(true);
  const [showEstimates, setShowEstimates] = useState(false);
  // Estimate-layer sub-filter so Jared can isolate "where I lost" or
  // "where active estimates are sitting" when the all-pins view is too dense.
  const [estimateFilter, setEstimateFilter] = useState<"all" | "active" | "lost">("all");

  // Year filter (set 2026-05-12) — multi-select across estimate years.
  // Years derived from estimate/proposal/result dates (estimates) and
  // start dates (booked jobs). Presets: "current year" (default), "last
  // 3 years", "all time". Multi-year selection works for cross-year
  // comparison (e.g., "2026 + 2027" once 2027 data exists).
  const currentYear = new Date().getFullYear();
  // Discover the set of years present in the data so the chip strip
  // only shows years that have leads — no point offering 2024 if no
  // 2024 data exists yet.
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    for (const e of estimates) {
      const y = yearForEstimate(e);
      if (y) set.add(y);
    }
    for (const j of jobs) {
      const y = yearForJob(j);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => b - a); // newest first
  }, [estimates, jobs]);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set([currentYear]));
  // If currentYear isn't yet in the data on first render, default to
  // the newest year that IS in the data.
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.some((y) => selectedYears.has(y))) {
      setSelectedYears(new Set([availableYears[0]]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYears.join(",")]);

  function toggleYear(y: number) {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      // Empty selection = treat as "all" so map never goes blank by accident
      if (next.size === 0) return new Set(availableYears);
      return next;
    });
  }
  function selectAllYears() {
    setSelectedYears(new Set(availableYears));
  }
  function selectLastN(n: number) {
    setSelectedYears(new Set(availableYears.slice(0, n)));
  }
  function isAllYearsSelected(): boolean {
    return availableYears.every((y) => selectedYears.has(y)) && selectedYears.size === availableYears.length;
  }
  function isCurrentYearOnly(): boolean {
    return selectedYears.size === 1 && selectedYears.has(currentYear);
  }

  // Today's ISO for "active" filter — anchored to Vancouver (PST/PDT)
  // so the rollover happens at local midnight, not UTC midnight.
  const todayISO = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${d}`;
  })();

  // Combine jobs with their resolved coordinates
  const jobPins = useMemo(() => {
    if (!showBooked) return [];
    return jobs
      .filter((j) => {
        if (filterCrew !== "all" && (j.crew || "Unassigned") !== filterCrew) return false;
        if (filterStatus === "active") {
          if (j.status === "Complete") return false;
          if (j.endDate && j.endDate < todayISO) return false;
        }
        if (filterStatus === "in-progress") {
          // Only show jobs where today is within the scheduled span and
          // not yet marked Complete (matches the "In Production" auto-
          // derived status on the day-row dashboard).
          if (effectiveStatus(j) !== "In Production") return false;
        }
        // Year filter — show only if job's year is in selected set, OR
        // if job has no year date at all (don't drop unscheduled jobs).
        const jy = yearForJob(j);
        if (jy && !selectedYears.has(jy)) return false;
        return true;
      })
      .map((j) => {
        const coord = j.address ? geocodes[normalizeAddress(j.address)] : null;
        return { job: j, coord };
      })
      .filter((p): p is { job: ProductionJob; coord: GeoCoord } => p.coord != null);
  }, [jobs, geocodes, filterCrew, filterStatus, todayISO, showBooked, selectedYears]);

  // Estimate pins — independent of crew/status filters (those only apply
  // to booked jobs). When the estimates layer is on, we render every
  // estimate that has a resolved geocode.
  const estimatePins = useMemo(() => {
    if (!showEstimates) return [];
    return estimates
      .filter((e) => {
        if (estimateFilter === "active" && (e.stage === "Lost" || e.stage === "Won")) return false;
        if (estimateFilter === "lost" && e.stage !== "Lost") return false;
        // Year filter
        const ey = yearForEstimate(e);
        if (ey && !selectedYears.has(ey)) return false;
        return true;
      })
      .map((e) => {
        const coord = e.address ? geocodes[normalizeAddress(e.address)] : null;
        return { est: e, coord };
      })
      .filter((p): p is { est: EstimatePoint; coord: GeoCoord } => p.coord != null);
  }, [estimates, geocodes, showEstimates, estimateFilter, selectedYears]);

  const crews = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) set.add(j.crew || "Unassigned");
    return [...set].sort();
  }, [jobs]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const all: [number, number][] = [
      ...jobPins.map((p) => [p.coord.lat, p.coord.lon] as [number, number]),
      ...estimatePins.map((p) => [p.coord.lat, p.coord.lon] as [number, number]),
    ];
    if (all.length === 0) return null;
    if (all.length === 1) {
      const [lat, lon] = all[0];
      return [
        [lat - 0.05, lon - 0.05],
        [lat + 0.05, lon + 0.05],
      ];
    }
    return all;
  }, [jobPins, estimatePins]);

  // Identify jobs that PASS the current filter but DON'T have a
  // resolved coordinate — surface them so Jared sees which addresses
  // need fixing or which jobs are missing addresses entirely. Only
  // applies when the booked layer is on, since the missing-address
  // surface was designed for production hygiene.
  const filteredJobs = useMemo(() => {
    if (!showBooked) return [];
    return jobs.filter((j) => {
      if (filterCrew !== "all" && (j.crew || "Unassigned") !== filterCrew) return false;
      if (filterStatus === "active") {
        if (j.status === "Complete") return false;
        if (j.endDate && j.endDate < todayISO) return false;
      }
      if (filterStatus === "in-progress") {
        if (effectiveStatus(j) !== "In Production") return false;
      }
      return true;
    });
  }, [jobs, filterCrew, filterStatus, todayISO, showBooked]);
  const missingJobs = useMemo(() => {
    return filteredJobs.filter((j) => {
      if (!j.address || !j.address.trim()) return true;
      const c = geocodes[normalizeAddress(j.address)];
      return !c;
    });
  }, [filteredJobs, geocodes]);
  const missingGeocode = missingJobs.length;
  const [showMissing, setShowMissing] = useState(false);

  return (
    <div className="space-y-3">
      {/* Year filter (set 2026-05-12). Multi-select chips + 3 presets
          (current / last 3 / all). Only renders years actually present
          in the data — grows naturally as new years' data is captured.
          Filter applies to BOTH the Booked layer (via job startDate)
          and the Estimates layer (via estDate || proposalDate || resultDate). */}
      {availableYears.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border p-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Year:</span>
          <div className="flex items-center gap-1">
            {availableYears.map((y) => {
              const active = selectedYears.has(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => toggleYear(y)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-bold rounded-md border transition",
                    active
                      ? "bg-cc-navy text-white border-cc-navy"
                      : "bg-white text-text-secondary border-border hover:border-cc-accent/40"
                  )}
                  title={active ? `Hide ${y}` : `Show ${y}`}
                >
                  {y}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1 ml-1 text-[10px]">
            <button
              type="button"
              onClick={() => setSelectedYears(new Set([currentYear]))}
              className={cn(
                "px-2 py-1 font-semibold rounded-md border transition",
                isCurrentYearOnly()
                  ? "bg-cc-accent text-white border-cc-accent"
                  : "bg-white text-text-muted border-border hover:border-cc-accent/40"
              )}
            >
              This year
            </button>
            <button
              type="button"
              onClick={() => selectLastN(3)}
              className="px-2 py-1 font-semibold rounded-md border bg-white text-text-muted border-border hover:border-cc-accent/40 transition"
              disabled={availableYears.length < 2}
            >
              Last 3 years
            </button>
            <button
              type="button"
              onClick={selectAllYears}
              className={cn(
                "px-2 py-1 font-semibold rounded-md border transition",
                isAllYearsSelected()
                  ? "bg-cc-accent text-white border-cc-accent"
                  : "bg-white text-text-muted border-border hover:border-cc-accent/40"
              )}
            >
              All time
            </button>
          </div>
          <span className="ml-auto text-[10px] text-text-muted italic">
            Filters both Booked + Estimate layers
          </span>
        </div>
      )}

      {/* Layer toggles — top row. Booked + Estimates are the two
          independent layers. Both can be on simultaneously; default is
          Booked on / Estimates off so existing muscle memory still
          works. Crew + status filters below apply only to booked jobs. */}
      <div className="bg-surface rounded-2xl border border-border p-3 flex items-center gap-4 flex-wrap text-sm">
        <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Layers:</span>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showBooked}
            onChange={(e) => setShowBooked(e.target.checked)}
            className="w-4 h-4 accent-cc-navy"
          />
          <span className="font-semibold text-text-primary">Booked jobs</span>
          <span className="text-xs text-text-muted">
            ({jobPins.length}{showBooked ? "" : " hidden"})
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showEstimates}
            onChange={(e) => setShowEstimates(e.target.checked)}
            className="w-4 h-4 accent-cc-accent"
          />
          <span className="font-semibold text-text-primary">Estimates</span>
          <span className="text-xs text-text-muted">
            ({estimatePins.length}{showEstimates ? "" : " hidden"})
          </span>
        </label>
        {showEstimates && (
          <select
            value={estimateFilter}
            onChange={(e) => setEstimateFilter(e.target.value as "all" | "active" | "lost")}
            className="px-2 py-1 text-xs font-semibold rounded border border-border bg-white"
          >
            <option value="all">All estimates</option>
            <option value="active">Active only (no Lost)</option>
            <option value="lost">Lost only</option>
          </select>
        )}
      </div>

      {/* Booked-job filters (crew + status) — only meaningful when the
          booked layer is on. Hidden otherwise to reduce clutter. */}
      {showBooked && (
        <div className="bg-surface rounded-2xl border border-border p-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Booked filter:</span>
          <select
            value={filterCrew}
            onChange={(e) => setFilterCrew(e.target.value)}
            className="px-2 py-1 text-xs font-semibold rounded border border-border bg-white"
          >
            <option value="all">All crews</option>
            {crews.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "all" | "active" | "in-progress")}
            className="px-2 py-1 text-xs font-semibold rounded border border-border bg-white"
          >
            <option value="in-progress">In progress today (crews on-site)</option>
            <option value="active">Active (future + in progress)</option>
            <option value="all">All jobs (incl. completed)</option>
          </select>
          <div className="ml-auto text-xs text-text-muted flex items-center gap-2">
            {missingGeocode > 0 && (
              <button
                onClick={() => setShowMissing((v) => !v)}
                className="text-amber-700 hover:text-amber-900 font-semibold underline-offset-2 hover:underline"
              >
                {missingGeocode} missing {showMissing ? "▴" : "▾"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expandable list of jobs missing addresses or pending geocode.
          Surfaces exactly which records need a fix so they don't stay
          invisible forever. */}
      {showBooked && showMissing && missingJobs.length > 0 && (
        <div className="bg-surface rounded-2xl border border-amber-200 p-3">
          <div className="text-xs uppercase tracking-wider font-bold text-amber-700 mb-2">
            Not on map ({missingJobs.length})
          </div>
          <ul className="space-y-1 text-sm">
            {missingJobs.map((j) => (
              <li key={j.jobId} className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-text-primary">{j.name}</span>
                {j.crew && <span className="text-[10px] uppercase tracking-wider text-text-muted">· {j.crew}</span>}
                {j.address ? (
                  <span className="text-xs text-text-muted">
                    has address but geocode pending: <code className="bg-zinc-100 px-1 py-0.5 rounded text-[11px]">{j.address}</code>
                  </span>
                ) : (
                  <span className="text-xs text-rose-700 font-semibold">missing address — add via the job drawer</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted italic mt-2">
            Geocoding runs on first page load — pending entries usually resolve within ~30 seconds. Missing-address entries need the address filled in via the job drawer on the Production page.
          </p>
        </div>
      )}

      {/* Legend for the Estimates layer — only renders when it's on.
          Color-coded by stage so density patterns by stage are readable. */}
      {showEstimates && estimatePins.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border p-3 flex items-center gap-4 flex-wrap text-xs">
          <span className="uppercase tracking-wider text-text-muted font-bold">Estimate legend:</span>
          <LegendDot color="#F19E3D" label="Proposal Sent" />
          <LegendDot color="#10b981" label="Verbal Yes" />
          <LegendDot color="#a855f7" label="On Hold" />
          <LegendDot color="#0ea5e9" label="Long-Term" />
          <LegendDot color="#16a34a" label="Won (past)" />
          <LegendDot color="#94a3b8" label="Lost" />
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-border overflow-hidden">
        <MapContainer
          center={[49.105, -123.15]} // Steveston/Tsawwassen midpoint
          zoom={11}
          style={{ height: "calc(100vh - 280px)", minHeight: 400, width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToBounds bounds={bounds} />

          {/* Estimates render BEFORE booked jobs so booked pins sit on
              top — Jared wants booked-job pins to read first when both
              layers are on. */}
          {estimatePins.map(({ est, coord }) => {
            const color = colorForEstimateStage(est.stage);
            return (
              <Marker
                key={`est-${est.source}-${est.id}-${est.address}`}
                position={[coord.lat, coord.lon]}
                icon={makeEstimateIcon(color)}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-bold text-cc-navy">{est.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{est.address}</div>
                    <div className="text-xs mt-1.5 space-y-0.5">
                      <div>
                        <span className="font-semibold">Stage:</span> {est.stage}
                      </div>
                      {est.estDate && (
                        <div>
                          <span className="font-semibold">Estimate date:</span> {est.estDate}
                        </div>
                      )}
                      {est.estValue > 0 && (
                        <div>
                          <span className="font-semibold">Est value:</span>{" "}
                          {formatCurrency(est.estValue)}
                        </div>
                      )}
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">
                        {est.source === "archive-lost" ? "Archive · Lost" : "Active pipeline"}
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {jobPins.map(({ job, coord }) => {
            const crew = job.crew || "Unassigned";
            const color = colorForCrew(crew);
            const initials = crew
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() || "")
              .join("");
            return (
              <Marker
                key={job.jobId}
                position={[coord.lat, coord.lon]}
                icon={makeJobIcon(color, initials || "·")}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-bold text-cc-navy">{job.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{job.address}</div>
                    <div className="text-xs mt-1.5 space-y-0.5">
                      <div>
                        <span className="font-semibold">Crew:</span> {crew}
                        {job.crewStatus && job.crewStatus !== "Confirmed" && (
                          <span className="text-amber-700"> ({job.crewStatus})</span>
                        )}
                      </div>
                      {job.startDate && (
                        <div>
                          <span className="font-semibold">Dates:</span> {job.startDate}
                          {job.endDate && job.endDate !== job.startDate ? ` → ${job.endDate}` : ""}
                        </div>
                      )}
                      {job.bookedValue > 0 && (
                        <div>
                          <span className="font-semibold">Booked:</span> {formatCurrency(job.bookedValue)}
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full border border-white shadow-sm"
        style={{ background: color }}
      />
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}
