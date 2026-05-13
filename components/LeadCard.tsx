"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, MessageSquare, PhoneOff, Check, Flame, Clock, AlertTriangle, Calendar, RefreshCw } from "lucide-react";
import { LeadDrawer } from "./LeadDrawer";
import { cn, relativeDate, todayISO } from "@/lib/utils";
import type { ScoredLead } from "@/lib/types";
import { leadsCommsState, leadsPhase, suggestedNextLeadTouchDate } from "@/lib/leadsCadence";

interface Props {
  lead: ScoredLead;
  emphasize?: boolean;
}

function stageColor(stage: string): string {
  switch (stage) {
    case "New":
      return "bg-sky-100 text-sky-800 border-sky-200";
    case "Attempted contact":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Callback requested":
      return "bg-rose-100 text-rose-800 border-rose-200";
    case "Estimate booked":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Long-term hold":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "Lost":
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
    default:
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
  }
}

function summarize(notes: string, max = 110): string {
  if (!notes) return "";
  const stripped = notes.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).replace(/[\s,.;:-]+$/, "") + "…";
}

export function LeadCard({ lead, emphasize }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busyTouch, setBusyTouch] = useState<string | null>(null);
  const [recentSave, setRecentSave] = useState<string | null>(null);
  const today = todayISO();

  const comms = leadsCommsState(lead);
  const phase = leadsPhase(lead);

  const nextTouchRel = lead.nextTouchDate ? relativeDate(lead.nextTouchDate, today) : null;
  const lastTouchRel = lead.lastTouchDate ? relativeDate(lead.lastTouchDate, today) : null;
  const isOverdue = nextTouchRel?.includes("overdue") || comms.level === "rose";

  // Severity ring on the card
  const severityRing =
    comms.level === "rose"
      ? "before:bg-rose-500"
      : comms.level === "amber"
        ? "before:bg-amber-500"
        : "before:bg-emerald-500";

  // Estimate visit context
  const estimateVisitDate = lead.estimateVisitDate;
  const daysToVisit = estimateVisitDate
    ? Math.round(
        (new Date(estimateVisitDate + "T12:00:00Z").getTime() -
          new Date(today + "T12:00:00Z").getTime()) /
          86400000
      )
    : null;

  async function quickLog(type: "Call" | "VM" | "Email" | "Text", e: React.MouseEvent) {
    e.stopPropagation();
    setBusyTouch(type);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, action: "touch", type }),
      });

      // Smart next-touch adjustment
      const currentNext = lead.nextTouchDate;
      const ideal = suggestedNextLeadTouchDate(lead, today, today);
      let shouldAdjust = false;
      if (!currentNext) {
        shouldAdjust = true;
      } else {
        const daysToCurrent = Math.round(
          (new Date(currentNext + "T12:00:00Z").getTime() -
            new Date(today + "T12:00:00Z").getTime()) /
            86400000
        );
        if (daysToCurrent < phase.minGapFromLast || daysToCurrent > phase.maxGapDays) {
          shouldAdjust = true;
        }
      }
      if (shouldAdjust) {
        await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, action: "snooze", date: ideal }),
        });
      }

      setRecentSave(type);
      setTimeout(() => setRecentSave(null), 1800);
      startTransition(() => router.refresh());
    } catch {
      // silent
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
        data-lead-card
        data-lead-id={lead.id || lead.name}
        onClick={() => setOpen(true)}
        onKeyDown={handleKey}
        className={cn(
          "group relative w-full text-left bg-surface border border-border rounded-xl p-4 transition-all duration-150 cursor-pointer elev-card",
          "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-xl",
          severityRing,
          "hover:border-cc-accent/40 hover:-translate-y-px",
          "focus:outline-none focus:ring-2 focus:ring-cc-accent",
          emphasize && "ring-1 ring-cc-accent/40"
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              {lead.stage === "Callback requested" && (
                <Flame className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              )}
              <h3 className="font-semibold text-text-primary truncate text-[15px] leading-tight">
                {lead.name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border",
                  stageColor(lead.stage)
                )}
              >
                {lead.stage}
              </span>
              {lead.leadSource && (
                <span className="text-[11px] text-text-muted">{lead.leadSource}</span>
              )}
              {/* Setup call pill — only on Estimate booked */}
              {lead.stage === "Estimate booked" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border",
                    lead.setupCallDone
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  )}
                  title={lead.setupCallDone ? "Setup call done" : "Setup call pending"}
                >
                  {lead.setupCallDone ? "✓ Setup" : "⚠ Setup pending"}
                </span>
              )}
              {/* Reschedule badge — shows from 1+ */}
              {lead.rescheduleCount >= 1 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200"
                  title={`Rescheduled ${lead.rescheduleCount} time${lead.rescheduleCount === 1 ? "" : "s"}`}
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  {lead.rescheduleCount}
                </span>
              )}
            </div>
          </div>
          {/* Right-side context — varies by stage */}
          <div className="text-right shrink-0">
            {lead.stage === "Estimate booked" && estimateVisitDate ? (
              <div className="text-[11px] font-semibold text-text-secondary leading-tight">
                <div className="text-cc-navy font-bold tabular-nums">
                  {estimateVisitDate.slice(5)}
                </div>
                <div className="text-text-muted">
                  {daysToVisit === 0
                    ? "today"
                    : daysToVisit === 1
                      ? "tmrw"
                      : daysToVisit && daysToVisit < 0
                        ? `${Math.abs(daysToVisit)}d ago`
                        : daysToVisit
                          ? `in ${daysToVisit}d`
                          : ""}
                </div>
              </div>
            ) : lead.stage === "Callback requested" && lead.callbackTime ? (
              <div className="text-[11px] font-semibold text-rose-700 leading-tight">
                <div className="font-bold uppercase">CALL</div>
                <div className="text-rose-600">{lead.callbackTime}</div>
              </div>
            ) : lead.stage === "Long-term hold" && lead.longTermReachOutDate ? (
              <div className="text-[11px] font-semibold text-slate-600 leading-tight">
                <div className="font-bold tabular-nums">{lead.longTermReachOutDate.slice(0, 7)}</div>
                <div className="text-slate-500">reach-out</div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Priority reason — what got this lead surfaced */}
        {lead.priorityReasons.length > 0 && lead.priorityScore >= 500 && (
          <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
            <AlertTriangle className="w-3 h-3" />
            {lead.priorityReasons[0]}
          </div>
        )}

        {lead.notes && (
          <p className="mt-1 text-[13px] text-text-secondary line-clamp-2 leading-snug">
            {summarize(lead.notes)}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-3 text-text-muted">
            {lastTouchRel && (
              <span title={`Last touch: ${lead.lastTouchDate}`}>
                {lastTouchRel}
                {lead.lastTouchType && ` · ${lead.lastTouchType.toLowerCase()}`}
              </span>
            )}
            {!lead.lastTouchDate && lead.contactAttempts > 0 && (
              <span className="text-amber-700">{lead.contactAttempts} attempt{lead.contactAttempts === 1 ? "" : "s"}, no reply</span>
            )}
            {!lead.lastTouchDate && lead.contactAttempts === 0 && (
              <span className="text-rose-600">never reached</span>
            )}
          </div>
          {lead.nextTouchDate ? (
            <div
              className={cn(
                "flex items-center gap-1 font-medium",
                isOverdue ? "text-cc-danger" : "text-text-secondary"
              )}
            >
              <Calendar className="w-3 h-3" />
              <span className="tabular-nums">{nextTouchRel}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-text-muted">
              <Clock className="w-3 h-3" />
              <span>no FU set</span>
            </div>
          )}
        </div>

        {/* Hover quick-log row */}
        <div className="mt-2 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="text-[10px] uppercase tracking-wide text-text-muted truncate">
            {recentSave ? `✓ Logged ${recentSave.toLowerCase()}` : phase.label}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {lead.phone && (
              <>
                <QuickLogBtn icon={<Phone className="w-3 h-3" />} label="Call" busy={busyTouch === "Call"} done={recentSave === "Call"} onClick={(e) => quickLog("Call", e)} />
                <QuickLogBtn icon={<PhoneOff className="w-3 h-3" />} label="VM" busy={busyTouch === "VM"} done={recentSave === "VM"} onClick={(e) => quickLog("VM", e)} />
                <QuickLogBtn icon={<MessageSquare className="w-3 h-3" />} label="Text" busy={busyTouch === "Text"} done={recentSave === "Text"} onClick={(e) => quickLog("Text", e)} />
              </>
            )}
            {lead.email && (
              <QuickLogBtn icon={<Mail className="w-3 h-3" />} label="Email" busy={busyTouch === "Email"} done={recentSave === "Email"} onClick={(e) => quickLog("Email", e)} />
            )}
          </div>
        </div>
      </div>

      <LeadDrawer lead={lead} open={open} onClose={() => setOpen(false)} />
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
