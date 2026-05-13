"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MessageCircle, MessageCircleQuestion, Info, Pencil, Flame } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ScoredOpportunity } from "@/lib/types";
import { salesCommsState, suggestedNextSalesTouchDate } from "@/lib/salesCadence";

interface Props {
  opp: ScoredOpportunity;
}

/**
 * Communication section for the Opportunity drawer.
 *
 * Mirrors `ProductionCommunicationSection` for the sales side. Driven by
 * `lib/salesCadence.ts` (TTD + phase-anchored cadence per the
 * Follow-Up Cadence SOP). Top-of-drawer surface for managing sales
 * follow-up rhythm.
 *
 * Encapsulates:
 *  - Phase chip + SOP guidance (click bucket to expand)
 *  - Comms state chip (Fresh / Aging / Overdue / Due today / Promise overdue)
 *  - Verbal Yes promise countdown when applicable
 *  - Last / Next touch stat cards
 *  - Smart "Just talked to them" button (cadence-suggested next-touch)
 *  - Override buttons (1d / 3d / 7d / 14d / custom)
 *  - Backdate / custom-dates form for retrospective logging
 *  - Optimistic UI for instant feedback
 */
export function SalesCommunicationSection({ opp }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [optimisticLast, setOptimisticLast] = useState<string | null>(null);
  const [optimisticNext, setOptimisticNext] = useState<string | null>(null);
  const [sopExpanded, setSopExpanded] = useState(false);
  const [backdate, setBackdate] = useState(false);
  const [lastDraft, setLastDraft] = useState(opp.lastTouchDate || todayISO());
  const [nextDraft, setNextDraft] = useState(opp.nextFollowUpDate || "");
  const [touchTypeDraft, setTouchTypeDraft] = useState<"Call" | "VM" | "Email" | "Text">("Call");

  useEffect(() => {
    setLastDraft(opp.lastTouchDate || todayISO());
    setNextDraft(opp.nextFollowUpDate || "");
    setSopExpanded(false);
    setBackdate(false);
    setOptimisticLast((prev) => (prev !== null && (opp.lastTouchDate || "") === prev ? null : prev));
    setOptimisticNext((prev) => (prev !== null && (opp.nextFollowUpDate || "") === prev ? null : prev));
  }, [opp]);

  const effectiveOpp: ScoredOpportunity = {
    ...opp,
    lastTouchDate: optimisticLast !== null ? optimisticLast || null : opp.lastTouchDate,
    nextFollowUpDate: optimisticNext !== null ? optimisticNext || null : opp.nextFollowUpDate,
  };
  const state = salesCommsState(effectiveOpp, todayISO());

  const LEVEL_CLASS: Record<typeof state.level, { chip: string; dot: string }> = {
    green: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
    amber: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
    rose: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
    none: { chip: "bg-zinc-100 text-zinc-700", dot: "bg-zinc-400" },
  };
  const lc = LEVEL_CLASS[state.level];
  const suggested = state.suggestedNextTouchDays;

  async function call(name: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(name);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, ...body }),
      });
      if (!res.ok) return false;
      startTransition(() => router.refresh());
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" />
          Communication
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSopExpanded((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md transition",
              sopExpanded ? "bg-cc-navy text-white" : "bg-cc-navy/8 text-cc-navy hover:bg-cc-navy/15"
            )}
            title="Click to see SOP guidance for this phase"
            aria-expanded={sopExpanded}
          >
            {state.phase.label}
            <Info className="w-2.5 h-2.5 opacity-70" />
          </button>
          <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md", lc.chip)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", lc.dot)} />
            {state.label}
          </span>
        </div>
      </div>
      {sopExpanded && (
        <div className="text-[11px] text-text-secondary leading-snug bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 mb-2.5">
          <span className="font-bold text-cc-navy">SOP for {state.phase.label}:</span> {state.phase.guidance}
        </div>
      )}

      {/* Verbal Yes promise countdown — when VY stage + promise set */}
      {opp.stage === "Verbal Yes" && opp.promise && opp.promisedTime && (
        <PromiseTimer promisedTime={opp.promisedTime} />
      )}

      <div className="grid grid-cols-2 gap-2 text-xs mb-2.5">
        <div className="bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 group/last">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center justify-between">
            <span>Last contact</span>
            <button
              onClick={() => {
                setBackdate(true);
                setLastDraft(opp.lastTouchDate || todayISO());
                setNextDraft(opp.nextFollowUpDate || "");
              }}
              className="opacity-0 group-hover/last:opacity-100 text-text-muted hover:text-cc-navy transition-opacity"
              title="Edit dates (backdate)"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div className="text-sm font-bold text-text-primary leading-tight">
            {effectiveOpp.lastTouchDate ? formatRelativePast(effectiveOpp.lastTouchDate) : <span className="text-text-muted font-medium italic">No contact yet</span>}
          </div>
          {effectiveOpp.lastTouchDate && (
            <div className="text-[10px] text-text-muted tabular-nums">
              {effectiveOpp.lastTouchDate}
              {opp.lastTouchType && <span> · {opp.lastTouchType}</span>}
            </div>
          )}
        </div>
        <div className="bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 group/next">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center justify-between">
            <span>Next follow-up</span>
            <button
              onClick={() => {
                setBackdate(true);
                setLastDraft(opp.lastTouchDate || todayISO());
                setNextDraft(opp.nextFollowUpDate || "");
              }}
              className="opacity-0 group-hover/next:opacity-100 text-text-muted hover:text-cc-navy transition-opacity"
              title="Edit dates"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div className="text-sm font-bold text-text-primary leading-tight">
            {effectiveOpp.nextFollowUpDate ? formatRelativeFuture(effectiveOpp.nextFollowUpDate) : <span className="text-text-muted font-medium italic">Not scheduled</span>}
          </div>
          {effectiveOpp.nextFollowUpDate && (
            <div className="text-[10px] text-text-muted tabular-nums">
              {effectiveOpp.nextFollowUpDate}
              {opp.nextFollowUpType && <span> · {opp.nextFollowUpType}</span>}
            </div>
          )}
        </div>
      </div>

      {!backdate && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {/* Snooze-only buttons — DO NOT log a Call touch. Touch type
              is captured via the Quick Actions row in DrawerActions (which
              handles Call/VM/Email/Text properly). Before 2026-05-11 these
              buttons auto-logged "Call" regardless of context, which
              double-counted touches and overwrote real Email/Text logs. */}
          <button
            onClick={() => {
              const today = todayISO();
              const nd = new Date(today + "T12:00:00Z");
              nd.setUTCDate(nd.getUTCDate() + suggested);
              setOptimisticNext(nd.toISOString().slice(0, 10));
              call("snooze-cadence", { action: "snooze", days: suggested });
            }}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 transition-colors"
            title={`Sets next follow-up to ${suggested}d per SOP for "${state.phase.label}". Log the touch separately via Quick Actions below.`}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" />
            {busy
              ? "Saving…"
              : suggested === 0
                ? "Snooze · next: tomorrow"
                : `Snooze · next: ${suggested}d`}
          </button>
          <span className="text-[10px] text-text-muted mx-1">Override next:</span>
          {[1, 3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => {
                const today = todayISO();
                const nd = new Date(today + "T12:00:00Z");
                nd.setUTCDate(nd.getUTCDate() + d);
                setOptimisticNext(nd.toISOString().slice(0, 10));
                call(`snooze-${d}`, { action: "snooze", days: d });
              }}
              disabled={busy !== null}
              className={cn(
                "px-2 py-1 text-[11px] font-semibold rounded-md border bg-white hover:bg-zinc-50 disabled:opacity-50 transition",
                suggested === d ? "border-cc-accent text-cc-accent ring-1 ring-cc-accent/40" : "border-border text-text-secondary"
              )}
              title={`Snooze next follow-up to ${d}d from today`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => {
              setBackdate(true);
              setLastDraft(opp.lastTouchDate || todayISO());
              setNextDraft(opp.nextFollowUpDate || "");
            }}
            className="ml-auto text-[11px] text-text-muted hover:text-cc-navy underline-offset-2 hover:underline transition"
            title="Backdate or set specific dates"
          >
            Backdate / custom dates
          </button>
        </div>
      )}

      {backdate && (
        <div className="bg-zinc-50 border border-border rounded-md p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block mb-1">
                Last contact
              </label>
              <input
                type="date"
                value={lastDraft}
                max={todayISO()}
                onChange={(e) => {
                  setLastDraft(e.target.value);
                  if (e.target.value) {
                    setNextDraft(suggestedNextSalesTouchDate(opp, e.target.value, todayISO()));
                  }
                }}
                className="w-full px-2 py-1 text-xs rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
              />
              <div className="flex gap-1 mt-1">
                {[0, 1, 2, 3].map((d) => {
                  const date = new Date(todayISO() + "T12:00:00Z");
                  date.setUTCDate(date.getUTCDate() - d);
                  const iso = date.toISOString().slice(0, 10);
                  const label = d === 0 ? "Today" : d === 1 ? "Yest" : `${d}d ago`;
                  return (
                    <button
                      key={d}
                      onClick={() => {
                        setLastDraft(iso);
                        setNextDraft(suggestedNextSalesTouchDate(opp, iso, todayISO()));
                      }}
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] font-semibold rounded border transition",
                        lastDraft === iso
                          ? "bg-cc-navy text-white border-cc-navy"
                          : "bg-white border-border text-text-secondary hover:bg-zinc-100"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block mb-1">
                Next follow-up
              </label>
              <input
                type="date"
                value={nextDraft}
                min={todayISO()}
                onChange={(e) => setNextDraft(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
              />
              <div className="flex gap-1 mt-1 flex-wrap">
                {[suggested, 1, 3, 7, 14].map((d, i) => {
                  const date = new Date(todayISO() + "T12:00:00Z");
                  date.setUTCDate(date.getUTCDate() + d);
                  const iso = date.toISOString().slice(0, 10);
                  return (
                    <button
                      key={`${d}-${i}`}
                      onClick={() => setNextDraft(iso)}
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] font-semibold rounded border transition",
                        nextDraft === iso
                          ? "bg-cc-navy text-white border-cc-navy"
                          : i === 0
                            ? "bg-white border-cc-accent text-cc-accent hover:bg-cc-accent-soft/40"
                            : "bg-white border-border text-text-secondary hover:bg-zinc-100"
                      )}
                      title={i === 0 ? "SOP-suggested per phase" : ""}
                    >
                      {d}d
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Touch type:</span>
            {(["Call", "VM", "Email", "Text"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTouchTypeDraft(t)}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold rounded border transition",
                  touchTypeDraft === t
                    ? "bg-cc-navy text-white border-cc-navy"
                    : "bg-white border-border text-text-secondary hover:bg-zinc-100"
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={async () => {
                let nextDate: string | null = nextDraft || null;
                if (!nextDate && lastDraft) {
                  nextDate = suggestedNextSalesTouchDate(opp, lastDraft, todayISO());
                }
                setOptimisticLast(lastDraft || "");
                setOptimisticNext(nextDate || "");
                if (lastDraft) {
                  await call("touch-backdate", { action: "touch", type: touchTypeDraft });
                  // Backdate the last-touch by re-writing via snooze with explicit date — TODO: needs new endpoint
                }
                if (nextDate) {
                  await call("snooze-explicit", { action: "snooze", date: nextDate, fuType: touchTypeDraft === "VM" ? "Call" : touchTypeDraft });
                }
                setBackdate(false);
              }}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs font-bold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 transition-colors"
            >
              {busy ? "Saving…" : "Save dates"}
            </button>
            <button
              onClick={() => setBackdate(false)}
              className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PromiseTimer({ promisedTime }: { promisedTime: string }) {
  const today = todayISO();
  const days = daysBetween(today, promisedTime);
  const overdue = days < 0;
  const dueToday = days === 0;
  return (
    <div className={cn(
      "rounded-md px-2.5 py-1.5 mb-2.5 text-xs font-semibold flex items-center gap-2",
      overdue ? "bg-rose-100 text-rose-800 border border-rose-300"
        : dueToday ? "bg-amber-100 text-amber-800 border border-amber-300"
          : "bg-emerald-50 text-emerald-800 border border-emerald-200"
    )}>
      <Flame className="w-3.5 h-3.5" />
      <span>
        Promise {overdue ? `${Math.abs(days)}d overdue` : dueToday ? "due TODAY" : `in ${days}d`} — by {promisedTime}
      </span>
    </div>
  );
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function formatRelativePast(iso: string): string {
  const today = todayISO();
  const d = daysBetween(iso, today);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 0) return `In ${Math.abs(d)}d`;
  if (d <= 14) return `${d}d ago`;
  if (d <= 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function formatRelativeFuture(iso: string): string {
  const today = todayISO();
  const d = daysBetween(today, iso);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d <= 14) return `In ${d}d`;
  if (d <= 60) return `In ${Math.round(d / 7)}w`;
  return `In ${Math.round(d / 30)}mo`;
}
