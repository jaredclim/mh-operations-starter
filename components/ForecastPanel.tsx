"use client";

import { useState } from "react";
import { TrendingUp, AlertCircle } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { ScoredOpportunity, Stage } from "@/lib/types";

interface Props {
  active: ScoredOpportunity[];
}

/**
 * Stage probability mapping. Default weights inspired by Pipedrive-style
 * stage probability tracking, calibrated against CC's sales-style:
 *
 *  Verbal Yes  → 70% (high commitment, deposit-collection is the blocker)
 *  Proposal Sent → 30% (warm but undecided)
 *  On Hold     → 15% (paused, lower expected close)
 *  Long-Term   → 8%  (way out, less near-term certainty)
 *
 * Heat tier as multiplier (final probability = stage * heat factor):
 *  hot:  1.15x
 *  warm: 1.0x
 *  cool: 0.85x
 *  cold: 0.6x
 *
 * Capped at 95% so we never overstate certainty.
 */
// Calibrated against Jared's actual close rates 2026-05-11:
//   - Overall blended target: 30-40% this year (currently ~25%, goal 50%)
//   - VY closes very high once deposit-paid email lands; system auto-moves
//     to Won. So VY in active pipeline = pre-deposit + 70% close
//   - Proposal Sent set to 35% reflecting pipeline-aided improvement
const STAGE_PROBABILITY: Record<Stage, number> = {
  "Verbal Yes": 0.70,
  "Proposal Sent": 0.35,
  "On Hold": 0.15,
  "Long-Term": 0.08,
  Won: 1.0,
  Lost: 0,
  Archived: 0,
  Unknown: 0.20,
};

const HEAT_FACTOR: Record<string, number> = {
  hot: 1.15,
  warm: 1.0,
  cool: 0.85,
  cold: 0.6,
};

interface StageGroupSummary {
  stage: Stage;
  count: number;
  rawValue: number;
  weightedValue: number;
  probability: number;
}

export function ForecastPanel({ active }: Props) {
  const [view, setView] = useState<"value" | "by-stage">("value");

  // Compute weighted forecast per opp + aggregate by stage
  const groups: Record<string, StageGroupSummary> = {};
  let totalRaw = 0;
  let totalWeighted = 0;
  for (const opp of active) {
    const baseProb = STAGE_PROBABILITY[opp.stage] ?? 0.20;
    const heatMult = HEAT_FACTOR[opp.heat.tier] ?? 1.0;
    const prob = Math.min(0.95, baseProb * heatMult);
    const weighted = opp.estValue * prob;
    totalRaw += opp.estValue;
    totalWeighted += weighted;
    if (!groups[opp.stage]) {
      groups[opp.stage] = {
        stage: opp.stage,
        count: 0,
        rawValue: 0,
        weightedValue: 0,
        probability: baseProb,
      };
    }
    groups[opp.stage].count += 1;
    groups[opp.stage].rawValue += opp.estValue;
    groups[opp.stage].weightedValue += weighted;
  }
  const sortedGroups = Object.values(groups).sort((a, b) => b.weightedValue - a.weightedValue);

  return (
    <section className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cc-accent" />
          Forecast · weighted pipeline
        </h2>
        <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5">
          {(["value", "by-stage"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition",
                view === v ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {v === "value" ? "Headline" : "By stage"}
            </button>
          ))}
        </div>
      </div>

      {view === "value" ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-zinc-50 border border-border rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">
                Raw pipeline value
              </div>
              <div className="text-2xl font-bold text-text-primary tabular-nums leading-none">
                {formatCurrency(totalRaw)}
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">{active.length} active opps</div>
            </div>
            <div className="bg-cc-accent-soft/60 border border-cc-accent/30 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-cc-navy mb-1">
                Weighted forecast
              </div>
              <div className="text-2xl font-bold text-cc-navy tabular-nums leading-none">
                {formatCurrency(totalWeighted)}
              </div>
              <div className="text-[11px] text-cc-navy/70 mt-0.5">
                {totalRaw > 0 ? Math.round((totalWeighted / totalRaw) * 100) : 0}% expected close
              </div>
            </div>
          </div>
          <p className="text-[11px] text-text-muted italic">
            Weighted = raw value × stage probability × heat factor. Stage probabilities: VY 70%, Proposal 30%, On Hold 15%, Long-Term 8%. Heat: hot ×1.15, warm ×1.0, cool ×0.85, cold ×0.6.
          </p>
        </>
      ) : (
        <ul className="space-y-1.5">
          {sortedGroups.map((g) => {
            const adjPct = g.rawValue > 0 ? (g.weightedValue / g.rawValue) * 100 : 0;
            return (
              <li key={g.stage} className="flex items-center gap-3 text-sm">
                <div className="w-32 shrink-0 font-semibold text-text-primary truncate">
                  {g.stage}
                  <span className="text-xs text-text-muted font-normal ml-1.5">· {g.count}</span>
                </div>
                <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-cc-accent/30"
                    style={{ width: "100%" }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-cc-accent rounded-full"
                    style={{ width: `${adjPct}%` }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right tabular-nums text-xs font-semibold text-cc-navy">
                  {formatCurrency(g.weightedValue).replace(/\.00$/, "")}
                </div>
                <div className="w-24 shrink-0 text-right tabular-nums text-xs text-text-muted">
                  / {formatCurrency(g.rawValue).replace(/\.00$/, "")}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalWeighted < 5000 && active.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Weighted forecast is light. Look for Hot leads in earlier stages to push toward Verbal Yes.</span>
        </div>
      )}
    </section>
  );
}
