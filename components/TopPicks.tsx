"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Flame, Phone, PhoneOff, Mail, MessageSquare, AlertCircle, TrendingUp, Clock, ChevronRight, Play } from "lucide-react";
import { cn, formatCurrency, todayISO } from "@/lib/utils";
import type { ScoredOpportunity } from "@/lib/types";
import { OppDrawer } from "./OppDrawer";
import { salesPhase, suggestedNextSalesTouchDate, cappedSmartSnoozeDate } from "@/lib/salesCadence";
import { buildFocusQueue, type FocusReasonKind } from "@/lib/focusQueue";

interface Props {
  // Now takes the full active list — TopPicks runs the SAME scoreForFocus
  // ranking as Focus Mode (per Jared 2026-05-12). Previously had its own
  // rankPicks() with different weights, causing the top-of-page list to
  // disagree with what Focus Mode showed.
  active: ScoredOpportunity[];
}

/**
 * Top 3 ranked actions across the Action Zone, presented as compact rows.
 * "What should I do RIGHT NOW?" answered in one glance.
 *
 * Ranking logic:
 *  - Promise overdue: +1000 priority
 *  - Verbal Yes with imminent promise: +900
 *  - Boiling/Hot heat + overdue: +500 + heat * 50
 *  - Just overdue: +200 - days-since (oldest first)
 *  - Today's high-value FU: +100 + log10(value)
 *  - Tomorrow's promised: +50
 *
 * High-value tiebreak.
 */
// Visual style for each focus-reason kind (icon + tint).
const REASON_STYLE: Record<FocusReasonKind, { icon: React.ReactNode; cls: string }> = {
  "promise-overdue":   { icon: <Flame className="w-4 h-4" />,        cls: "bg-rose-500/20 text-rose-300" },
  "promise-today":     { icon: <Flame className="w-4 h-4" />,        cls: "bg-rose-500/20 text-rose-300" },
  "verbal-yes-overdue":{ icon: <AlertCircle className="w-4 h-4" />,  cls: "bg-amber-500/20 text-amber-300" },
  "verbal-yes-deposit":{ icon: <AlertCircle className="w-4 h-4" />,  cls: "bg-amber-500/20 text-amber-300" },
  "hot-overdue":       { icon: <AlertCircle className="w-4 h-4" />,  cls: "bg-emerald-500/20 text-emerald-300" },
  "warm-overdue":      { icon: <AlertCircle className="w-4 h-4" />,  cls: "bg-rose-500/20 text-rose-300" },
  "cool-overdue":      { icon: <AlertCircle className="w-4 h-4" />,  cls: "bg-rose-500/20 text-rose-300" },
  "due-today":         { icon: <Clock className="w-4 h-4" />,        cls: "bg-cc-accent/20 text-cc-accent" },
  "phase-stale":       { icon: <TrendingUp className="w-4 h-4" />,   cls: "bg-cc-blue/20 text-cc-blue" },
};

export function TopPicks({ active }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [openOpp, setOpenOpp] = useState<ScoredOpportunity | null>(null);

  // Use SAME ranking as Focus Mode → top of page matches what you'd see
  // when you click "Focus mode" (per Jared 2026-05-12 bug report).
  const queue = buildFocusQueue(active, { today: todayISO(), scope: "today" });
  const ranked = queue.slice(0, 3);

  if (ranked.length === 0) return null;

  // Same smart-adjust logic as OppCard.quickLog — log the touch, then
  // only adjust next-FU if the current one is out of healthy cadence
  // range. Respects Jared's note-driven next-FU workflow.
  async function quickLog(opp: ScoredOpportunity, type: "Call" | "VM" | "Email" | "Text") {
    setBusy(opp.id || opp.name);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type }),
      });
      // Smart next-FU adjustment (with Verbal Yes / Promise cap)
      const today = todayISO();
      const phase = salesPhase(opp, today);
      const currentNextFu = opp.nextFollowUpDate;
      const idealNext = cappedSmartSnoozeDate(opp, today, suggestedNextSalesTouchDate(opp, today, today));
      let shouldAdjust = false;
      if (!currentNextFu) {
        shouldAdjust = true;
      } else {
        const daysUntilCurrent = Math.round(
          (new Date(currentNextFu + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000
        );
        if (daysUntilCurrent < phase.minGapFromLast || daysUntilCurrent > phase.maxGapDays) {
          shouldAdjust = true;
        }
      }
      if (shouldAdjust) {
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "snooze", date: idealNext }),
        });
      }
      setRecent(opp.id || opp.name);
      setTimeout(() => setRecent(null), 1800);
      startTransition(() => router.refresh());
    } catch {
      // fail silent — drawer has fuller error UX
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-cc-navy text-white rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm uppercase tracking-wider font-bold flex items-center gap-2 text-cc-accent">
          <TrendingUp className="w-4 h-4" />
          What to do next · top 3
        </h2>
        <Link
          href="/focus"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md bg-cc-accent text-cc-navy hover:bg-cc-accent/90 transition shadow-md shadow-cc-accent/20"
          title="Enter Focus Mode — work today's call queue one at a time"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          Focus mode
        </Link>
      </div>
      <ul className="space-y-1.5">
        {ranked.map((pick) => {
          const id = pick.opp.id || pick.opp.name;
          const isDone = recent === id;
          const style = REASON_STYLE[pick.reasonKind] || REASON_STYLE["due-today"];
          return (
            <li
              key={id}
              className={cn(
                "bg-white/8 backdrop-blur rounded-lg p-3 flex items-center gap-3 hover:bg-white/12 transition cursor-pointer",
                isDone && "ring-2 ring-emerald-400/60"
              )}
              onClick={() => setOpenOpp(pick.opp)}
            >
              <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", style.cls)}>
                {style.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm truncate">{pick.opp.name}</span>
                  {pick.opp.estValue > 0 && (
                    <span className="text-[11px] font-bold text-cc-accent tabular-nums shrink-0">
                      {formatCurrency(pick.opp.estValue)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-white/70 truncate">{pick.reason}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {pick.opp.phone && (
                  <>
                    <button
                      onClick={() => quickLog(pick.opp, "Call")}
                      disabled={busy === id}
                      title="Quick log: Called (talked)"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-cc-accent text-cc-navy hover:bg-cc-accent/90 disabled:opacity-50 transition"
                    >
                      <Phone className="w-3 h-3" />
                      Call
                    </button>
                    <button
                      onClick={() => quickLog(pick.opp, "VM")}
                      disabled={busy === id}
                      title="Quick log: Left voicemail"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition"
                    >
                      <PhoneOff className="w-3 h-3" />
                      VM
                    </button>
                    <button
                      onClick={() => quickLog(pick.opp, "Text")}
                      disabled={busy === id}
                      title="Quick log: Texted"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition"
                    >
                      <MessageSquare className="w-3 h-3" />
                      Text
                    </button>
                  </>
                )}
                {pick.opp.email && (
                  <button
                    onClick={() => quickLog(pick.opp, "Email")}
                    disabled={busy === id}
                    title="Quick log: Emailed"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition"
                  >
                    <Mail className="w-3 h-3" />
                    Email
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-white/40" />
              </div>
            </li>
          );
        })}
      </ul>
      {openOpp && (
        <OppDrawer opp={openOpp} open={true} onClose={() => setOpenOpp(null)} />
      )}
    </section>
  );
}

// Legacy rankPicks() removed 2026-05-12 — replaced with buildFocusQueue
// for parity between the top-of-page "What to do next" and the Focus
// Mode queue. Previously these used different scoring logic, causing
// mismatched leads to appear at the top of the list vs in Focus Mode.
