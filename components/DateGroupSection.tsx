"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { OppCard } from "./OppCard";
import { cn, formatCurrencyShort } from "@/lib/utils";
import type { DateBucket } from "@/lib/types";

const ACCENT: Record<DateBucket["key"], string> = {
  overdue: "border-l-rose-500",
  today: "border-l-amber-500",
  next7: "border-l-yellow-500",
  next14: "border-l-blue-500",
  next30: "border-l-emerald-500",
  next90: "border-l-slate-400",
  unscheduled: "border-l-slate-300",
};

interface Props {
  bucket: DateBucket;
}

export function DateGroupSection({ bucket }: Props) {
  const [open, setOpen] = useState(bucket.defaultExpanded);
  const count = bucket.opportunities.length;

  return (
    <section
      className={cn(
        "rounded-2xl bg-surface border border-border border-l-4 overflow-hidden",
        ACCENT[bucket.key]
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 sm:px-5 py-3 hover:bg-zinc-50/60 transition"
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          )}
          <span className="text-base font-semibold text-text-primary">
            {bucket.label}
          </span>
          <span className="text-sm text-text-secondary tabular-nums">
            {count} {count === 1 ? "lead" : "leads"}
          </span>
        </div>
        {bucket.totalValue > 0 && (
          <span className="text-sm font-semibold text-cc-navy tabular-nums">
            {formatCurrencyShort(bucket.totalValue)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-5 pt-1">
          {count === 0 ? (
            <p className="text-sm text-text-muted py-4">Nothing here.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {bucket.opportunities.map((opp) => (
                <OppCard key={opp.id || opp.name} opp={opp} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
