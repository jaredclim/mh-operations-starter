"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, Flame, Calendar, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { HeadlinePanel } from "./HeadlinePanel";
import { PipelineHealthCard } from "./PipelineHealthCard";
import { SmartInsightsPanel } from "./SmartInsightsPanel";
import { ActionZoneSection } from "./ActionZone";
import { TopPicks } from "./TopPicks";
import { WinLossPanel } from "./WinLossPanel";
import { ForecastPanel } from "./ForecastPanel";
import { HeatGroupSection } from "./HeatGroupSection";
import { DateGroupSection } from "./DateGroupSection";
import { OppDrawer } from "./OppDrawer";
import { CommandPalette } from "./CommandPalette";
import { OppCard } from "./OppCard";
import { SegmentationLens, type SegmentLens, jobSizeBucket } from "./SegmentationLens";
import { usePersistentState } from "@/lib/usePersistentState";
import { cn, formatCurrencyShort } from "@/lib/utils";
import type { DashboardData, ScoredOpportunity, Stage } from "@/lib/types";

type GroupBy = "heat" | "date" | "stage";

const STAGE_FILTERS: Array<{ key: "all" | Stage; label: string }> = [
  { key: "all", label: "All" },
  { key: "Verbal Yes", label: "Verbal Yes" },
  { key: "Proposal Sent", label: "Proposal Sent" },
  { key: "On Hold", label: "On Hold" },
  { key: "Long-Term", label: "Long-Term" },
];

const STAGE_ORDER: Stage[] = [
  "Verbal Yes",
  "Proposal Sent",
  "On Hold",
  "Long-Term",
];

interface Props {
  data: DashboardData;
}

export function PipelineCockpit({ data }: Props) {
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>("cc.groupBy", "heat");
  const [stageFilter, setStageFilter] = usePersistentState<"all" | Stage>("cc.stageFilter", "all");
  const [segment, setSegment] = usePersistentState<SegmentLens>("cc.segment", "none");
  const [search, setSearch] = useState("");
  const [paletteOpp, setPaletteOpp] = useState<ScoredOpportunity | null>(null);

  // Keyboard nav between visible cards (j/k)
  const [activeCardIdx, setActiveCardIdx] = useState<number | null>(null);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (o: ScoredOpportunity) => {
      if (stageFilter !== "all" && o.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.address.toLowerCase().includes(q) ||
        o.notes.toLowerCase().includes(q) ||
        o.leadSource.toLowerCase().includes(q)
      );
    };
  }, [search, stageFilter]);

  const filteredHeat = useMemo(
    () =>
      data.heatBuckets.map((b) => {
        const opportunities = b.opportunities.filter(matches);
        return {
          ...b,
          opportunities,
          totalValue: opportunities.reduce((acc, o) => acc + o.estValue, 0),
        };
      }),
    [data.heatBuckets, matches]
  );

  const filteredDate = useMemo(
    () =>
      data.dateBuckets.map((b) => {
        const opportunities = b.opportunities.filter(matches);
        return {
          ...b,
          opportunities,
          totalValue: opportunities.reduce((acc, o) => acc + o.estValue, 0),
        };
      }),
    [data.dateBuckets, matches]
  );

  const filteredByStage = useMemo(() => {
    const out: Record<Stage, ScoredOpportunity[]> = {
      "Proposal Sent": [],
      "Verbal Yes": [],
      "On Hold": [],
      "Long-Term": [],
      Won: [],
      Lost: [],
      Archived: [],
      Unknown: [],
    };
    for (const o of data.active.filter(matches)) out[o.stage].push(o);
    return out;
  }, [data.active, matches]);

  const segmented = useMemo(() => {
    if (segment === "none") return null;
    const filtered = data.active.filter(matches);
    const groups = new Map<string, ScoredOpportunity[]>();
    for (const o of filtered) {
      const key =
        segment === "leadSource"
          ? o.leadSource || "Unknown"
          : jobSizeBucket(o.estValue);
      const arr = groups.get(key) || [];
      arr.push(o);
      groups.set(key, arr);
    }
    // Sort groups by total value desc
    return Array.from(groups.entries())
      .map(([key, opps]) => ({
        key,
        opps: opps.sort((a, b) => b.heat.score - a.heat.score),
        total: opps.reduce((acc, o) => acc + o.estValue, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [data.active, matches, segment]);

  const totalShown = useMemo(
    () => data.active.filter(matches).length,
    [data.active, matches]
  );

  const isFiltered = search !== "" || stageFilter !== "all";

  // Keyboard nav: j/k navigates active card, Enter opens
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const visible = data.active.filter(matches);
      if (visible.length === 0) return;
      if (e.key === "j") {
        e.preventDefault();
        setActiveCardIdx((i) => (i === null ? 0 : Math.min(visible.length - 1, i + 1)));
      } else if (e.key === "k") {
        e.preventDefault();
        setActiveCardIdx((i) => (i === null ? 0 : Math.max(0, i - 1)));
      } else if (e.key === "Enter" && activeCardIdx !== null) {
        e.preventDefault();
        setPaletteOpp(visible[activeCardIdx]);
      } else if (e.key === "Escape" && activeCardIdx !== null) {
        setActiveCardIdx(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.active, matches, activeCardIdx]);

  // Scroll active card into view
  useEffect(() => {
    if (activeCardIdx === null) return;
    const els = document.querySelectorAll("[data-opp-card]");
    const el = els[activeCardIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeCardIdx]);

  // Active search mode — when the user types in the search box, switch
  // to a flat "Search Results" view. The dashboard panels (TopPicks,
  // Insights, Forecast, etc.) hide so the matching card is the only
  // thing on screen — fixes Jared's "I type Frank and nothing changes"
  // bug (set 2026-05-12). Stage filter alone doesn't trigger this view;
  // only an actual text query does.
  const isSearching = search.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return data.active
      .filter(matches)
      .sort((a, b) => b.heat.score - a.heat.score);
  }, [data.active, matches, isSearching]);

  return (
    <div className="space-y-5">
      {!isSearching && <HeadlinePanel headline={data.headline} />}

      {/* Filter bar — moved up 2026-05-11 so search is immediately
          discoverable. Sticky on scroll so it follows Jared as he scans.
          Press / anywhere to focus the search input. */}
      <div className="bg-surface rounded-2xl border border-border p-3 sm:p-4 sticky top-2 z-20 backdrop-blur-md bg-surface/95">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={groupBy} onChange={setGroupBy} />
            <SegmentationLens value={segment} onChange={setSegment} />
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search… or press / "
                className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent focus:border-transparent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STAGE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStageFilter(f.key)}
                className={cn(
                  "text-xs font-semibold px-3 py-1.5 rounded-full border transition",
                  stageFilter === f.key
                    ? "bg-cc-navy text-white border-cc-navy"
                    : "bg-white text-text-secondary border-border hover:bg-zinc-50"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {isFiltered && (
          <div className="mt-3 text-xs text-text-secondary">
            Showing <span className="font-semibold text-text-primary">{totalShown}</span> of{" "}
            {data.health.activeCount} active
          </div>
        )}
      </div>

      {/* Search Results — when the user is actively searching, replace
          all the dashboard panels with a flat results grid. Matches are
          sorted by heat score so the most relevant ones surface first. */}
      {isSearching && (
        <section className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-text-primary">
              Search results <span className="text-text-muted font-normal">· {searchResults.length}</span>
            </h3>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-xs text-cc-blue hover:text-cc-navy font-semibold"
            >
              Clear search
            </button>
          </div>
          {searchResults.length === 0 ? (
            <div className="text-sm text-text-muted italic py-6 text-center">
              No active leads match &ldquo;{search}&rdquo;. Try a different term or clear the search.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {searchResults.map((opp) => (
                <OppCard key={opp.id || opp.name} opp={opp} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* What to do next — top 3 highest-impact actions right now.
          Uses the SAME scoring as Focus Mode (buildFocusQueue) so the
          top of the page matches what you'd see when clicking "Focus
          mode" — fixed 2026-05-12 per Jared's mismatch bug report. */}
      {!isSearching && <TopPicks active={data.active} />}

      {!isSearching && <PipelineHealthCard health={data.health} active={data.active} />}

      {!isSearching && <SmartInsightsPanel insights={data.smartInsights} />}

      {!isSearching && <ActionZoneSection zone={data.actionZone} />}

      {/* Forecast (weighted pipeline) — kept.
          WinLossPanel REMOVED 2026-05-11 per Jared: the Archive sheet
          doesn't reflect the actual full year of wins/losses. */}
      {!isSearching && <ForecastPanel active={data.active} />}

      {/* Grouped views — hidden during search since the flat results
          panel above already shows every match. */}
      {!isSearching && <AnimatePresence mode="wait">
        {segment !== "none" && segmented ? (
          <motion.div
            key="segmented"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {segmented.map((g) => (
              <section key={g.key} className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-text-primary">
                    {g.key} <span className="text-text-muted font-normal">· {g.opps.length}</span>
                  </h3>
                  {g.total > 0 && (
                    <span className="text-sm font-semibold text-cc-navy tabular-nums">
                      {formatCurrencyShort(g.total)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {g.opps.map((opp) => (
                    <OppCard key={opp.id || opp.name} opp={opp} />
                  ))}
                </div>
              </section>
            ))}
          </motion.div>
        ) : groupBy === "heat" ? (
          <motion.div
            key="heat"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {filteredHeat.map((b) => (
              <HeatGroupSection key={b.key} bucket={b} />
            ))}
          </motion.div>
        ) : groupBy === "date" ? (
          <motion.div
            key="date"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-3"
          >
            {filteredDate.map((b) => (
              <DateGroupSection key={b.key} bucket={b} />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="stage"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {STAGE_ORDER.map((s) => {
              const opps = filteredByStage[s] || [];
              if (opps.length === 0) return null;
              const total = opps.reduce((acc, o) => acc + o.estValue, 0);
              return (
                <section key={s} className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-text-primary">
                      {s} <span className="text-text-muted font-normal">· {opps.length}</span>
                    </h3>
                    {total > 0 && (
                      <span className="text-sm font-semibold text-cc-navy tabular-nums">
                        {formatCurrencyShort(total)}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {opps.map((opp) => (
                      <OppCard key={opp.id || opp.name} opp={opp} />
                    ))}
                  </div>
                </section>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>}

      <CommandPalette
        opportunities={data.active}
        onPick={(opp) => setPaletteOpp(opp)}
      />
      {paletteOpp && (
        <OppDrawer
          opp={paletteOpp}
          open={!!paletteOpp}
          onClose={() => setPaletteOpp(null)}
        />
      )}

      {/* Footer hint about keyboard shortcuts */}
      <div className="text-center text-[11px] text-text-muted pb-6 pt-2">
        Shortcuts:
        <KbdInline>⌘K</KbdInline> palette ·
        <KbdInline>/</KbdInline> palette ·
        <KbdInline>j</KbdInline> <KbdInline>k</KbdInline> next/prev card ·
        <KbdInline>↵</KbdInline> open ·
        <KbdInline>esc</KbdInline> close
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (v: GroupBy) => void;
}) {
  const options: { key: GroupBy; label: string; icon: React.ReactNode }[] = [
    { key: "heat", label: "Heat", icon: <Flame className="w-3.5 h-3.5" /> },
    { key: "date", label: "Date", icon: <Calendar className="w-3.5 h-3.5" /> },
    { key: "stage", label: "Stage", icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition",
            value === o.key
              ? "bg-white text-cc-navy shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KbdInline({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-1 inline-flex items-center px-1.5 py-0.5 bg-zinc-100 border border-border rounded text-[10px] font-semibold text-text-secondary">
      {children}
    </kbd>
  );
}
