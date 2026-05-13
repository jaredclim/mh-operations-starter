"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Snowflake, ArrowDown, Archive } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { OppCard } from "./OppCard";
import { HEAT_META } from "@/lib/heat";
import { cn, formatCurrencyShort } from "@/lib/utils";
import type { HeatBucket } from "@/lib/types";

const RING: Record<HeatBucket["key"], string> = {
  hot: "ring-emerald-200",
  warm: "ring-amber-200",
  cool: "ring-sky-200",
  cold: "ring-slate-200",
};

const TINT: Record<HeatBucket["key"], string> = {
  hot: "bg-emerald-50/40",
  warm: "bg-amber-50/40",
  cool: "bg-sky-50/40",
  cold: "bg-slate-50",
};

const HEADER_COLOR: Record<HeatBucket["key"], string> = {
  hot: "text-emerald-700",
  warm: "text-amber-700",
  cool: "text-sky-700",
  cold: "text-slate-600",
};

function ActionPrompt({ tier, count }: { tier: "cool" | "cold"; count: number }) {
  if (tier === "cool") {
    return (
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-sky-800">
          <ArrowDown className="w-4 h-4 shrink-0" />
          <span>
            <strong>{count} cooling.</strong> A short check-in note can move them back warm.
          </span>
        </div>
        <span className="text-[11px] text-sky-700/70 italic">
          Tip: reference a specific detail from notes
        </span>
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-slate-700">
        <Snowflake className="w-4 h-4 shrink-0" />
        <span>
          <strong>{count} cold.</strong> Send re-engagement once or archive if truly lost.
        </span>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-600/80 italic">
        <Archive className="w-3 h-3" />
        Bulk-archive coming in V3
      </span>
    </div>
  );
}

interface Props {
  bucket: HeatBucket;
  defaultOpen?: boolean;
}

export function HeatGroupSection({ bucket, defaultOpen }: Props) {
  const meta = HEAT_META[bucket.key];
  const [open, setOpen] = useState(
    defaultOpen ?? (bucket.key === "hot" || bucket.key === "warm")
  );
  const count = bucket.opportunities.length;

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-surface ring-1 transition",
        RING[bucket.key]
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 hover:bg-zinc-50/60 transition rounded-t-2xl",
          !open && "rounded-b-2xl"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? (
            <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
          )}
          <span className="text-lg" aria-hidden>{meta.icon}</span>
          <div className="text-left min-w-0">
            <div className={cn("text-base sm:text-lg font-bold uppercase tracking-wider", HEADER_COLOR[bucket.key])}>
              {meta.label}
            </div>
            <div className="text-xs text-text-secondary truncate">
              {meta.description}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-base font-semibold text-text-primary tabular-nums">{count}</div>
            <div className="text-[10px] uppercase tracking-wide text-text-muted">leads</div>
          </div>
          {bucket.totalValue > 0 && (
            <div className="text-right">
              <div className="text-base font-semibold text-cc-navy tabular-nums">
                {formatCurrencyShort(bucket.totalValue)}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">value</div>
            </div>
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn("overflow-hidden", TINT[bucket.key])}
          >
            <div className="px-4 sm:px-5 pb-5 pt-1">
              {(bucket.key === "cool" || bucket.key === "cold") && count > 0 && (
                <ActionPrompt tier={bucket.key} count={count} />
              )}
              {count === 0 ? (
                <p className="text-sm text-text-muted py-6 text-center italic">
                  {bucket.key === "cold"
                    ? "Nothing cold. Pipeline is healthy."
                    : bucket.key === "cool"
                    ? "Nothing cooling off."
                    : `Nothing ${meta.label.toLowerCase()} right now.`}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {bucket.opportunities.map((opp) => (
                    <OppCard key={opp.id || opp.name} opp={opp} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
