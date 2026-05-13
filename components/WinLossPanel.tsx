"use client";

import { useState } from "react";
import { Trophy, XCircle, TrendingDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { ArchiveRecord } from "@/lib/types";

interface Props {
  archive: ArchiveRecord[];
}

interface ReasonRow {
  reason: string;
  count: number;
  value: number;
  pct: number;
}

/**
 * Win/Loss analysis panel. Aggregates the Archive sheet's `reasonLost`
 * column into a sorted distribution. Identifies the dominant lost-reason
 * pattern across recent deals.
 *
 * Useful for:
 *  - Pricing strategy (if "Price" is 40%+ of losses → quotes too high or
 *    objection-handling needs work)
 *  - Process gaps (if "Unresponsive" is high → cadence aggressive enough?)
 *  - Win-rate at scale (overall ratio + average ticket of wins vs losses)
 */
export function WinLossPanel({ archive }: Props) {
  const [period, setPeriod] = useState<"30d" | "90d" | "all">("90d");
  const now = new Date();
  const filtered = archive.filter((a) => {
    if (period === "all") return true;
    if (!a.resultDate) return false;
    const date = new Date(a.resultDate + "T12:00:00Z");
    const days = Math.round((now.getTime() - date.getTime()) / 86400000);
    return period === "30d" ? days <= 30 : days <= 90;
  });

  const won = filtered.filter((a) => a.result === "Won");
  const lost = filtered.filter((a) => a.result === "Lost");
  const total = won.length + lost.length;
  const winRate = total > 0 ? (won.length / total) * 100 : 0;

  const wonValue = won.reduce((sum, a) => sum + (a.bookedValue || a.estValue), 0);
  const lostValue = lost.reduce((sum, a) => sum + a.estValue, 0);

  // Aggregate lost reasons
  const reasonCounts = new Map<string, { count: number; value: number }>();
  for (const a of lost) {
    const raw = a.reasonLost || "Unknown";
    // Normalize "Other: something" into "Other"
    const key = raw.startsWith("Other:") ? "Other" : raw;
    const existing = reasonCounts.get(key) || { count: 0, value: 0 };
    reasonCounts.set(key, { count: existing.count + 1, value: existing.value + a.estValue });
  }
  const reasonRows: ReasonRow[] = Array.from(reasonCounts.entries())
    .map(([reason, { count, value }]) => ({
      reason,
      count,
      value,
      pct: lost.length > 0 ? (count / lost.length) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  if (filtered.length === 0) {
    return (
      <section className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
        <h2 className="text-base font-semibold text-text-primary mb-2 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-text-muted" />
          Win / Loss Analysis
        </h2>
        <p className="text-sm text-text-muted italic">
          No archive data yet for this period. Mark some deals Won or Lost to see the pattern emerge.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-text-muted" />
          Win / Loss Analysis
        </h2>
        <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5">
          {(["30d", "90d", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition",
                period === p ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {p === "all" ? "All time" : `Last ${p}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 flex items-center gap-1 mb-1">
            <Trophy className="w-3 h-3" /> Won
          </div>
          <div className="text-2xl font-bold text-emerald-800 tabular-nums leading-none">{won.length}</div>
          <div className="text-[11px] text-emerald-700 tabular-nums mt-0.5">{formatCurrency(wonValue)} booked</div>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700 flex items-center gap-1 mb-1">
            <XCircle className="w-3 h-3" /> Lost
          </div>
          <div className="text-2xl font-bold text-rose-800 tabular-nums leading-none">{lost.length}</div>
          <div className="text-[11px] text-rose-700 tabular-nums mt-0.5">{formatCurrency(lostValue)} lost</div>
        </div>
        <div className="bg-zinc-50 border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Win Rate</div>
          <div className="text-2xl font-bold text-text-primary tabular-nums leading-none">{winRate.toFixed(0)}%</div>
          <div className="text-[11px] text-text-muted mt-0.5">{won.length} of {total} closed</div>
        </div>
      </div>

      {reasonRows.length > 0 ? (
        <>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">
            Lost reasons · pattern
          </h3>
          <ul className="space-y-1.5">
            {reasonRows.map((r) => (
              <li key={r.reason} className="flex items-center gap-3 text-sm">
                <div className="w-32 shrink-0 font-semibold text-text-primary truncate">{r.reason}</div>
                <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-rose-400 rounded-full"
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
                <div className="w-12 shrink-0 text-right tabular-nums text-xs font-semibold text-text-secondary">
                  {r.pct.toFixed(0)}%
                </div>
                <div className="w-16 shrink-0 text-right tabular-nums text-xs text-text-muted">
                  {r.count} · {formatCurrency(r.value).replace(/\.00$/, "")}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-text-muted italic">
          No lost-reason data captured yet. Use the picklist when marking a deal Lost to start building this view.
        </p>
      )}
    </section>
  );
}
