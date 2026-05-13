"use client";

import { useState } from "react";
import { Lightbulb, ChevronRight, AlertCircle, Target, Zap } from "lucide-react";
import { OppDrawer } from "./OppDrawer";
import { cn } from "@/lib/utils";
import type { SmartInsight } from "@/lib/insights";
import type { ScoredOpportunity } from "@/lib/types";

const TONE: Record<SmartInsight["tone"], { icon: React.ReactNode; ring: string; bg: string; accent: string; label: string }> = {
  danger: {
    icon: <AlertCircle className="w-4 h-4" />,
    ring: "ring-rose-200",
    bg: "bg-rose-50/50",
    accent: "text-rose-700",
    label: "Critical",
  },
  warning: {
    icon: <Zap className="w-4 h-4" />,
    ring: "ring-amber-200",
    bg: "bg-amber-50/50",
    accent: "text-amber-700",
    label: "Promised",
  },
  opportunity: {
    icon: <Target className="w-4 h-4" />,
    ring: "ring-emerald-200",
    bg: "bg-emerald-50/50",
    accent: "text-emerald-700",
    label: "Opportunity",
  },
  good: {
    icon: <Target className="w-4 h-4" />,
    ring: "ring-sky-200",
    bg: "bg-sky-50/50",
    accent: "text-sky-700",
    label: "Good",
  },
};

interface Props {
  insights: SmartInsight[];
}

export function SmartInsightsPanel({ insights }: Props) {
  const [openOpp, setOpenOpp] = useState<ScoredOpportunity | null>(null);
  if (insights.length === 0) return null;

  return (
    <>
      <section className="bg-surface rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-border bg-gradient-to-r from-cc-navy/[0.02] to-transparent">
          <Lightbulb className="w-4 h-4 text-cc-accent" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary">
            Pipeline Insights
          </h2>
          <span className="text-xs text-text-muted">· cross-pipeline patterns &amp; leverage points</span>
        </div>
        <div className="divide-y divide-border">
          {insights.map((i) => {
            const t = TONE[i.tone];
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => i.opp && setOpenOpp(i.opp)}
                className={cn(
                  "w-full text-left flex items-start gap-3 px-4 sm:px-5 py-3.5 hover:bg-zinc-50/60 transition group",
                  t.bg
                )}
              >
                <span
                  className={cn(
                    "shrink-0 flex items-center justify-center w-7 h-7 rounded-lg ring-1",
                    t.ring,
                    t.accent,
                    "bg-white"
                  )}
                >
                  {t.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-[10px] uppercase tracking-wider font-bold", t.accent)}>
                      {t.label}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-text-primary leading-snug">
                    {i.headline}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5 leading-snug">
                    {i.detail}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold text-text-muted group-hover:text-cc-navy shrink-0 mt-1">
                  <span className="hidden sm:inline">{i.action}</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {openOpp && (
        <OppDrawer opp={openOpp} open={!!openOpp} onClose={() => setOpenOpp(null)} />
      )}
    </>
  );
}
