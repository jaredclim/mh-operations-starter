"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, MessageSquare, Calendar, Flame, Clock, PhoneOff, Check, ListChecks } from "lucide-react";
import { StageBadge } from "./StageBadge";
import { OppDrawer } from "./OppDrawer";
import { HeatDot } from "./HeatBadge";
import { cn, formatCurrency, relativeDate, todayISO } from "@/lib/utils";
import type { ScoredOpportunity } from "@/lib/types";
import { salesPhase, suggestedNextSalesTouchDate, cappedSmartSnoozeDate } from "@/lib/salesCadence";

function followUpIcon(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("call") || t.includes("vm") || t.includes("phone")) return <Phone className="w-3.5 h-3.5" />;
  if (t.includes("text") || t.includes("sms")) return <MessageSquare className="w-3.5 h-3.5" />;
  if (t.includes("email")) return <Mail className="w-3.5 h-3.5" />;
  return <Calendar className="w-3.5 h-3.5" />;
}

function summarize(notes: string, max = 110): string {
  if (!notes) return "";
  const stripped = notes.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).replace(/[\s,.;:-]+$/, "") + "…";
}

interface Props {
  opp: ScoredOpportunity;
  emphasize?: boolean;
}

export function OppCard({ opp, emphasize }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busyTouch, setBusyTouch] = useState<string | null>(null);
  const [recentSave, setRecentSave] = useState<string | null>(null);
  const [snoozeNotice, setSnoozeNotice] = useState<string | null>(null);
  const today = todayISO();
  const followUpRel = opp.nextFollowUpDate ? relativeDate(opp.nextFollowUpDate, today) : null;
  const isOverdue = followUpRel?.includes("overdue");

  // Verbal Yes promise countdown — shown inline on card if promise active
  const promiseDaysOut = opp.promise && opp.promisedTime
    ? Math.round((new Date(opp.promisedTime + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000)
    : null;

  const heatEdge: Record<string, string> = {
    hot: "before:bg-emerald-500",
    warm: "before:bg-amber-500",
    cool: "before:bg-sky-500",
    cold: "before:bg-slate-400",
  };

  // Card-hover quick-log: logs the touch, then INTELLIGENTLY adjusts the
  // next-FU date only if needed. Logic (per Jared 2026-05-11):
  //   1. Always log the touch (action=touch, type=Call/VM/Email/Text)
  //   2. Check the existing nextFollowUpDate against phase cadence:
  //      - If empty → set to suggested
  //      - If too soon (< minGapFromLast days after today) → push to suggested
  //      - If too far out (> maxGapDays after today) → pull in to suggested
  //      - Otherwise leave alone (his notes drive the date when it's
  //        already reasonable)
  // This respects Jared's note-driven workflow while keeping cadence
  // healthy when he logs a touch without a planned next-FU.
  async function quickLog(type: "Call" | "VM" | "Email" | "Text", e: React.MouseEvent) {
    e.stopPropagation();
    setBusyTouch(type);
    try {
      // 1. Log the touch
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type }),
      });

      // 2. Smart next-FU adjustment
      const today = todayISO();
      const phase = salesPhase(opp, today);
      const currentNextFu = opp.nextFollowUpDate;
      const rawIdeal = suggestedNextSalesTouchDate(opp, today, today);
      // Cap: Verbal Yes never beyond 3d, Promise=YES never beyond 5d.
      // Stops the "card vanishes after VM click" bug for hot leads.
      const idealNext = cappedSmartSnoozeDate(opp, today, rawIdeal);
      let shouldAdjust = false;

      if (!currentNextFu) {
        shouldAdjust = true;
      } else {
        const daysUntilCurrent = Math.round(
          (new Date(currentNextFu + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000
        );
        if (daysUntilCurrent < phase.minGapFromLast) {
          shouldAdjust = true;
        } else if (daysUntilCurrent > phase.maxGapDays) {
          shouldAdjust = true;
        }
      }

      if (shouldAdjust) {
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "snooze", date: idealNext }),
        });
        // Visible confirmation so user knows where the lead just went.
        const label = new Date(idealNext + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
        setSnoozeNotice(`→ ${label}`);
        setTimeout(() => setSnoozeNotice(null), 3500);
      }

      setRecentSave(type);
      setTimeout(() => setRecentSave(null), 1800);
      startTransition(() => router.refresh());
    } catch {
      // Silent fail; the drawer handles error UX. Card stays optimistic-clean.
    } finally {
      setBusyTouch(null);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-opp-card
        data-opp-id={opp.id || opp.name}
        onClick={() => setOpen(true)}
        onKeyDown={handleKey}
        className={cn(
          "group relative w-full text-left bg-surface border border-border rounded-xl p-4 transition-all duration-150 cursor-pointer elev-card",
          "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-xl",
          heatEdge[opp.heat.tier],
          "hover:border-cc-accent/40 hover:-translate-y-px",
          "focus:outline-none focus:ring-2 focus:ring-cc-accent",
          emphasize && "ring-1 ring-cc-accent/40"
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <HeatDot tier={opp.heat.tier} />
              {opp.promise && (
                <Flame className="w-3.5 h-3.5 text-cc-danger shrink-0" />
              )}
              <h3 className="font-semibold text-text-primary truncate text-[15px] leading-tight">
                {opp.name}
              </h3>
              {/* Outstanding-todo badge — small icon + count, no text.
                  Only renders when there are incomplete items so the
                  card stays uncluttered. Tooltip + drawer click drill in. */}
              {(() => {
                const open = (opp.todoList || []).filter((t) => !t.done).length;
                if (open === 0) return null;
                return (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-bold tabular-nums shrink-0"
                    title={`${open} outstanding to-do${open === 1 ? "" : "s"} — click to view`}
                    aria-label={`${open} outstanding to-do items`}
                  >
                    <ListChecks className="w-3 h-3" />
                    {open}
                  </span>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StageBadge stage={opp.stage} />
              {opp.leadSource && (
                <span className="text-[11px] text-text-muted">{opp.leadSource}</span>
              )}
              {/* Verbal Yes promise timer pill */}
              {opp.stage === "Verbal Yes" && opp.promise && promiseDaysOut != null && (
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md",
                  promiseDaysOut < 0
                    ? "bg-rose-100 text-rose-800"
                    : promiseDaysOut === 0
                      ? "bg-amber-100 text-amber-800"
                      : promiseDaysOut <= 2
                        ? "bg-amber-50 text-amber-700"
                        : "bg-emerald-50 text-emerald-700"
                )}>
                  <Flame className="w-2.5 h-2.5" />
                  {promiseDaysOut < 0
                    ? `Promise ${Math.abs(promiseDaysOut)}d overdue`
                    : promiseDaysOut === 0
                      ? "Promise today"
                      : `Promise in ${promiseDaysOut}d`}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {opp.estValue > 0 ? (
              <div className="text-base font-bold text-cc-navy tabular-nums leading-none">
                {formatCurrency(opp.estValue)}
              </div>
            ) : (
              <div className="text-[11px] text-text-muted italic leading-none">
                Not estimated
              </div>
            )}
          </div>
        </div>

        {opp.notes && (
          <p className="mt-2 text-[13px] text-text-secondary line-clamp-2 leading-snug">
            {summarize(opp.notes)}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-3 text-text-muted">
            {opp.lastTouchDate && (
              <span title={`Last touch: ${opp.lastTouchDate}`}>
                {relativeDate(opp.lastTouchDate, today)}
                {opp.lastTouchType && ` · ${opp.lastTouchType.toLowerCase()}`}
              </span>
            )}
            {!opp.lastTouchDate && (
              <span className="text-rose-600">no touch on record</span>
            )}
          </div>
          {opp.nextFollowUpDate ? (
            <div
              className={cn(
                "flex items-center gap-1 font-medium",
                isOverdue ? "text-cc-danger" : "text-text-secondary"
              )}
            >
              {followUpIcon(opp.nextFollowUpType)}
              <span className="tabular-nums">
                {opp.promise && opp.promisedTime ? `${opp.promisedTime} ` : ""}
                {followUpRel}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-text-muted">
              <Clock className="w-3 h-3" />
              <span>no FU set</span>
            </div>
          )}
        </div>

        {/* Quick-log action row — appears on hover. Each button writes a
            touch + advances next-follow-up per cadence. Stop propagation
            so the card's onClick doesn't open the drawer. */}
        <div className="mt-2 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">
            {snoozeNotice
              ? <span className="text-cc-accent font-semibold">FU {snoozeNotice}</span>
              : recentSave ? `✓ Logged ${recentSave.toLowerCase()}` : opp.heat.topReason}
          </div>
          <div className="flex items-center gap-1">
            <QuickLogBtn icon={<Phone className="w-3 h-3" />} label="Call" busy={busyTouch === "Call"} done={recentSave === "Call"} onClick={(e) => quickLog("Call", e)} />
            <QuickLogBtn icon={<PhoneOff className="w-3 h-3" />} label="VM" busy={busyTouch === "VM"} done={recentSave === "VM"} onClick={(e) => quickLog("VM", e)} />
            <QuickLogBtn icon={<Mail className="w-3 h-3" />} label="Email" busy={busyTouch === "Email"} done={recentSave === "Email"} onClick={(e) => quickLog("Email", e)} />
            <QuickLogBtn icon={<MessageSquare className="w-3 h-3" />} label="Text" busy={busyTouch === "Text"} done={recentSave === "Text"} onClick={(e) => quickLog("Text", e)} />
          </div>
        </div>
      </div>

      <OppDrawer opp={opp} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function QuickLogBtn({
  icon,
  label,
  busy,
  done,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  done: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`Quick log: ${label}`}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border transition",
        done
          ? "bg-emerald-100 border-emerald-300 text-emerald-800"
          : "bg-white border-border text-text-secondary hover:bg-zinc-50 hover:border-cc-accent/40",
        busy && "opacity-50 cursor-wait"
      )}
    >
      {done ? <Check className="w-3 h-3" /> : icon}
      <span>{label}</span>
    </button>
  );
}
