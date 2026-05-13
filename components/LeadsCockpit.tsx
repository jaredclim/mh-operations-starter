"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Layers, Plus, Upload } from "lucide-react";
import { LeadsHeadlinePanel } from "./LeadsHeadlinePanel";
import { LeadsHealthCard } from "./LeadsHealthCard";
import { LeadTopPicks } from "./LeadTopPicks";
import { LeadCard } from "./LeadCard";
import { LeadAddModal } from "./LeadAddModal";
import { LeadBulkImportModal } from "./LeadBulkImportModal";
import { usePersistentState } from "@/lib/usePersistentState";
import { cn } from "@/lib/utils";
import type { LeadsDashboardData, ScoredLead, LeadStage } from "@/lib/types";

const STAGE_FILTERS: Array<{ key: "all" | LeadStage; label: string }> = [
  { key: "all", label: "All" },
  { key: "New", label: "New" },
  { key: "Attempted contact", label: "Trying" },
  { key: "Callback requested", label: "Callback" },
  { key: "Estimate booked", label: "Estimate" },
  { key: "Long-term hold", label: "Long-term" },
];

const STAGE_ORDER: LeadStage[] = [
  "Callback requested",
  "New",
  "Attempted contact",
  "Estimate booked",
  "Long-term hold",
];

interface Props {
  data: LeadsDashboardData;
}

export function LeadsCockpit({ data }: Props) {
  const [stageFilter, setStageFilter] = usePersistentState<"all" | LeadStage>("cc.leads.stageFilter", "all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (l: ScoredLead) => {
      if (stageFilter !== "all" && l.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.address.toLowerCase().includes(q) ||
        l.notes.toLowerCase().includes(q) ||
        l.leadSource.toLowerCase().includes(q) ||
        l.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
      );
    };
  }, [search, stageFilter]);

  const filteredByStage = useMemo(() => {
    const out: Record<string, ScoredLead[]> = {};
    for (const s of STAGE_ORDER) out[s] = [];
    for (const l of data.active.filter(matches)) {
      if (!out[l.stage]) out[l.stage] = [];
      out[l.stage].push(l);
    }
    // Within each stage, sort by priority score desc then name
    for (const s of Object.keys(out)) {
      out[s].sort((a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name));
    }
    return out;
  }, [data.active, matches]);

  const totalShown = useMemo(() => data.active.filter(matches).length, [data.active, matches]);
  const isFiltered = search !== "" || stageFilter !== "all";

  return (
    <div className="space-y-5">
      <LeadsHeadlinePanel headline={data.headline} />

      {data.topPicks.length > 0 && <LeadTopPicks picks={data.topPicks} />}

      <LeadsHealthCard health={data.health} active={data.active} />

      {/* Filter bar */}
      <div className="bg-surface rounded-2xl border border-border p-3 sm:p-4 sticky top-2 z-20 backdrop-blur-md bg-surface/95">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep transition"
            >
              <Plus className="w-4 h-4" />
              Add lead
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white text-text-primary border border-border rounded-lg hover:bg-zinc-50 hover:border-cc-accent/40 transition"
            >
              <Upload className="w-4 h-4" />
              Bulk import
            </button>
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, address, phone, notes…"
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

      {/* Grouped by stage (default) */}
      <AnimatePresence mode="wait">
        <motion.div
          key="stage"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-4"
        >
          {STAGE_ORDER.map((s) => {
            const leads = filteredByStage[s] || [];
            if (leads.length === 0) return null;
            return (
              <section key={s} className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-text-primary">
                    <span
                      className={cn(
                        "inline-block w-2 h-2 rounded-full mr-2 align-middle",
                        stageDot(s)
                      )}
                    />
                    {s} <span className="text-text-muted font-normal">· {leads.length}</span>
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {leads.map((l) => (
                    <LeadCard key={l.id || l.name} lead={l} />
                  ))}
                </div>
              </section>
            );
          })}
          {totalShown === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center text-text-muted">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <div className="text-sm">No leads match your filters.</div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <LeadAddModal open={addOpen} onClose={() => setAddOpen(false)} />
      <LeadBulkImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function stageDot(s: LeadStage): string {
  switch (s) {
    case "New":
      return "bg-sky-400";
    case "Attempted contact":
      return "bg-amber-400";
    case "Callback requested":
      return "bg-rose-400";
    case "Estimate booked":
      return "bg-emerald-400";
    case "Long-term hold":
      return "bg-slate-400";
    default:
      return "bg-zinc-400";
  }
}
