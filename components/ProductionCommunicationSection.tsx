"use client";

import { useEffect, useState } from "react";
import { MessageCircle, MessageCircleQuestion, Info, Pencil } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ProductionJob } from "@/lib/types";
import { commsState, suggestedNextTouchDate } from "@/lib/commsCadence";

interface Props {
  job: ProductionJob;
  call: (name: string, body: Record<string, unknown>) => Promise<boolean>;
  busy: string | null;
  isPending: boolean;
}

/**
 * Communication section for the production job drawer.
 *
 * Extracted from ProductionJobDrawer.tsx 2026-05-10 so it can be mounted
 * at the TOP of the drawer body (highest-priority daily-use surface),
 * separately from the rest of the drawer fields. Encapsulates:
 *  - bucket display + SOP guidance (collapsed by default, expand via bucket chip)
 *  - last/next touch stats + state chip
 *  - "Just talked to them" + override buttons
 *  - backdate / custom dates form with smart auto-fill
 *  - optimistic UI for instant feedback while the ISR refresh propagates
 */
export function ProductionCommunicationSection({ job, call, busy, isPending }: Props) {
  const [optimisticLast, setOptimisticLast] = useState<string | null>(null);
  const [optimisticNext, setOptimisticNext] = useState<string | null>(null);
  const [sopExpanded, setSopExpanded] = useState(false);
  const [backdate, setBackdate] = useState(false);
  const [lastDraft, setLastDraft] = useState(job.lastClientTouch || todayISO());
  const [nextDraft, setNextDraft] = useState(job.nextClientTouch || "");

  useEffect(() => {
    setLastDraft(job.lastClientTouch || todayISO());
    setNextDraft(job.nextClientTouch || "");
    setSopExpanded(false);
    setBackdate(false);
    setOptimisticLast((prev) => (prev !== null && (job.lastClientTouch || "") === prev ? null : prev));
    setOptimisticNext((prev) => (prev !== null && (job.nextClientTouch || "") === prev ? null : prev));
  }, [job]);

  const effectiveJob: ProductionJob = {
    ...job,
    lastClientTouch: optimisticLast !== null ? optimisticLast || null : job.lastClientTouch,
    nextClientTouch: optimisticNext !== null ? optimisticNext || null : job.nextClientTouch,
  };
  const state = commsState(effectiveJob, todayISO());
  const LEVEL_CLASS: Record<typeof state.level, { chip: string; dot: string }> = {
    green: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
    amber: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
    rose: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
    none: { chip: "bg-zinc-100 text-zinc-700", dot: "bg-zinc-400" },
  };
  const lc = LEVEL_CLASS[state.level];
  const suggested = state.suggestedNextTouchDays;

  // Once job hits "In Production" the pre-job comms cadence is OVER
  // (per Jared 2026-05-12). During production, Jared + PM handle daily
  // client comms outside this dashboard. Show a minimal banner instead
  // of the full cadence UI so the drawer doesn't keep prompting for
  // next-touch actions that no longer apply.
  if (job.status === "In Production") {
    return (
      <section className="bg-amber-50 border border-amber-200 rounded-lg p-3 -mx-1">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider font-bold text-amber-900">
              In Production · Communication paused
            </div>
            <div className="text-[11px] text-amber-800 mt-0.5 leading-snug">
              Daily client comms during production are handled outside this dashboard. Mark Complete when the job wraps to re-enable the post-job touch surface.
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" />
          Communication
        </h3>
        <div className="flex items-center gap-1.5">
          {state.bucket.id !== "complete" ? (
            <button
              onClick={() => setSopExpanded((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md transition",
                sopExpanded ? "bg-cc-navy text-white" : "bg-cc-navy/8 text-cc-navy hover:bg-cc-navy/15"
              )}
              title="Click to see SOP guidance for this stage"
              aria-expanded={sopExpanded}
            >
              {state.bucket.label}
              <Info className="w-2.5 h-2.5 opacity-70" />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-cc-navy/8 text-cc-navy">
              {state.bucket.label}
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md", lc.chip)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", lc.dot)} />
            {state.label}
          </span>
        </div>
      </div>
      {sopExpanded && state.bucket.id !== "complete" && (
        <div className="text-[11px] text-text-secondary leading-snug bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 mb-2.5">
          <span className="font-bold text-cc-navy">SOP for {state.bucket.label}:</span> {state.bucket.windowGuidance}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs mb-2.5">
        <div className="bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 group/last">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center justify-between">
            <span>Last contact</span>
            <button
              onClick={() => {
                setBackdate(true);
                setLastDraft(job.lastClientTouch || todayISO());
                setNextDraft(job.nextClientTouch || "");
              }}
              className="opacity-0 group-hover/last:opacity-100 text-text-muted hover:text-cc-navy transition-opacity"
              title="Edit dates (backdate)"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div className="text-sm font-bold text-text-primary leading-tight">
            {effectiveJob.lastClientTouch ? formatRelativePast(effectiveJob.lastClientTouch) : <span className="text-text-muted font-medium italic">No contact yet</span>}
          </div>
          {effectiveJob.lastClientTouch && (
            <div className="text-[10px] text-text-muted tabular-nums">{effectiveJob.lastClientTouch}</div>
          )}
        </div>
        <div className="bg-zinc-50 border border-border rounded-md px-2.5 py-1.5 group/next">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center justify-between">
            <span>Next touch</span>
            <button
              onClick={() => {
                setBackdate(true);
                setLastDraft(job.lastClientTouch || todayISO());
                setNextDraft(job.nextClientTouch || "");
              }}
              className="opacity-0 group-hover/next:opacity-100 text-text-muted hover:text-cc-navy transition-opacity"
              title="Edit dates"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div className="text-sm font-bold text-text-primary leading-tight">
            {effectiveJob.nextClientTouch ? formatRelativeFuture(effectiveJob.nextClientTouch) : <span className="text-text-muted font-medium italic">Not scheduled</span>}
          </div>
          {effectiveJob.nextClientTouch && (
            <div className="text-[10px] text-text-muted tabular-nums">{effectiveJob.nextClientTouch}</div>
          )}
        </div>
      </div>
      {state.bucket.id !== "complete" && suggested != null && !backdate && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            onClick={() => {
              const today = todayISO();
              const nd = new Date(today + "T12:00:00Z");
              nd.setUTCDate(nd.getUTCDate() + suggested);
              setOptimisticLast(today);
              setOptimisticNext(nd.toISOString().slice(0, 10));
              call("touch", { action: "touch", nextDays: suggested });
            }}
            disabled={busy !== null || isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 transition-colors"
            title={`Logs today as last contact. Suggests next touch in ${suggested}d per SOP for "${state.bucket.label}".`}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" />
            {busy === "touch"
              ? "Logging…"
              : suggested === 0
                ? "Logged today · next: tomorrow"
                : `Logged today · next: ${suggested}d`}
          </button>
          <span className="text-[10px] text-text-muted mx-1">Override next:</span>
          {[1, 3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => {
                const today = todayISO();
                const nd = new Date(today + "T12:00:00Z");
                nd.setUTCDate(nd.getUTCDate() + d);
                setOptimisticLast(today);
                setOptimisticNext(nd.toISOString().slice(0, 10));
                call(`touch-${d}`, { action: "touch", nextDays: d });
              }}
              disabled={busy !== null || isPending}
              className={cn(
                "px-2 py-1 text-[11px] font-semibold rounded-md border bg-white hover:bg-zinc-50 disabled:opacity-50 transition",
                suggested === d ? "border-cc-accent text-cc-accent ring-1 ring-cc-accent/40" : "border-border text-text-secondary"
              )}
              title={`Override: log today + schedule next touch in ${d}d`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => {
              setBackdate(true);
              setLastDraft(job.lastClientTouch || todayISO());
              setNextDraft(job.nextClientTouch || "");
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
                    setNextDraft(suggestedNextTouchDate(job, e.target.value, todayISO()));
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
                        setNextDraft(suggestedNextTouchDate(job, iso, todayISO()));
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
                Next touch
              </label>
              <input
                type="date"
                value={nextDraft}
                min={todayISO()}
                onChange={(e) => setNextDraft(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
              />
              <div className="flex gap-1 mt-1 flex-wrap">
                {(suggested != null ? [suggested, 1, 3, 7, 14] : [1, 3, 7, 14, 30]).map((d, i) => {
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
                          : i === 0 && suggested != null
                            ? "bg-white border-cc-accent text-cc-accent hover:bg-cc-accent-soft/40"
                            : "bg-white border-border text-text-secondary hover:bg-zinc-100"
                      )}
                      title={i === 0 && suggested != null ? "SOP-suggested per bucket" : ""}
                    >
                      {d}d
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={async () => {
                let nextDate: string | null = nextDraft || null;
                if (!nextDate && lastDraft) {
                  nextDate = suggestedNextTouchDate(job, lastDraft, todayISO());
                }
                setOptimisticLast(lastDraft || "");
                setOptimisticNext(nextDate || "");
                const ok = await call("touchDates", {
                  action: "touchDates",
                  lastDate: lastDraft || null,
                  nextDate,
                });
                if (ok) setBackdate(false);
              }}
              disabled={busy !== null || isPending}
              className="px-3 py-1.5 text-xs font-bold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 transition-colors"
            >
              {busy === "touchDates" ? "Saving…" : "Save dates"}
            </button>
            <button
              onClick={() => setBackdate(false)}
              className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setOptimisticLast("");
                setOptimisticNext("");
                const ok = await call("touchDates", {
                  action: "touchDates",
                  lastDate: null,
                  nextDate: null,
                });
                if (ok) setBackdate(false);
              }}
              className="ml-auto text-[11px] text-rose-600 hover:text-rose-700 underline-offset-2 hover:underline transition"
              title="Clear both dates"
            >
              Clear dates
            </button>
          </div>
        </div>
      )}
    </section>
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
