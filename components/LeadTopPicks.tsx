"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Mail, MessageSquare, ChevronRight, AlertTriangle, Flame, Clock, Zap, CalendarClock } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ScoredLead, LeadStaleSignalKey } from "@/lib/types";
import { LeadDrawer } from "./LeadDrawer";
import { leadsPhase, suggestedNextLeadTouchDate } from "@/lib/leadsCadence";

interface Props {
  picks: ScoredLead[];
}

/**
 * Top picks panel — the #1 ask for the Leads dashboard. Surfaces the
 * 3 highest-priority leads to call right now, with inline 4-channel
 * quick-log so Jared can act without opening anything.
 *
 * Navy panel — matches Pipeline TopPicks visually for cross-dashboard
 * consistency.
 */
export function LeadTopPicks({ picks }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<ScoredLead | null>(null);

  if (picks.length === 0) return null;

  async function quickLog(lead: ScoredLead, type: "Call" | "VM" | "Email" | "Text") {
    setBusy(lead.id || lead.name);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, action: "touch", type }),
      });
      const today = todayISO();
      const phase = leadsPhase(lead);
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
      setRecent(lead.id || lead.name);
      setTimeout(() => setRecent(null), 1800);
      startTransition(() => router.refresh());
    } catch {
      // silent
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-cc-navy text-white rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider font-bold flex items-center gap-2 text-cc-accent">
          <Zap className="w-4 h-4" />
          Call right now
        </h2>
        <span className="text-[11px] text-white/60">
          Top {picks.length} priority {picks.length === 1 ? "lead" : "leads"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {picks.map((lead) => {
          const id = lead.id || lead.name;
          const isDone = recent === id;
          const reason = lead.priorityReasons[0] || lead.stage;
          const { icon, iconClass } = topPickIcon(lead);
          return (
            <li
              key={id}
              className={cn(
                "bg-white/8 backdrop-blur rounded-lg p-3 flex items-center gap-3 hover:bg-white/12 transition cursor-pointer",
                isDone && "ring-2 ring-emerald-400/60"
              )}
              onClick={() => setOpenLead(lead)}
            >
              <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", iconClass)}>
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm truncate">{lead.name}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-cc-accent shrink-0">
                    {lead.stage}
                  </span>
                </div>
                <div className="text-[11px] text-white/70 truncate">{reason}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {lead.phone && (
                  <>
                    <button
                      onClick={() => quickLog(lead, "Call")}
                      disabled={busy === id}
                      title="Quick log: Called"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-cc-accent text-cc-navy hover:bg-cc-accent/90 disabled:opacity-50 transition"
                    >
                      <Phone className="w-3 h-3" />
                      Call
                    </button>
                    <button
                      onClick={() => quickLog(lead, "VM")}
                      disabled={busy === id}
                      title="Quick log: VM"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition"
                    >
                      <PhoneOff className="w-3 h-3" />
                      VM
                    </button>
                    <button
                      onClick={() => quickLog(lead, "Text")}
                      disabled={busy === id}
                      title="Quick log: Text"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition"
                    >
                      <MessageSquare className="w-3 h-3" />
                      Text
                    </button>
                  </>
                )}
                {lead.email && (
                  <button
                    onClick={() => quickLog(lead, "Email")}
                    disabled={busy === id}
                    title="Quick log: Email"
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
      {openLead && (
        <LeadDrawer lead={openLead} open={true} onClose={() => setOpenLead(null)} />
      )}
    </section>
  );
}

function topPickIcon(lead: ScoredLead): { icon: React.ReactNode; iconClass: string } {
  // Choose icon based on the top stale signal
  const topSignal = lead.staleSignals[0]?.key as LeadStaleSignalKey | undefined;
  switch (topSignal) {
    case "callback-due":
      return { icon: <Phone className="w-4 h-4" />, iconClass: "bg-rose-500/20 text-rose-300" };
    case "never-reached":
      return { icon: <AlertTriangle className="w-4 h-4" />, iconClass: "bg-rose-500/20 text-rose-300" };
    case "inbound-today":
      return { icon: <Zap className="w-4 h-4" />, iconClass: "bg-amber-500/20 text-amber-300" };
    case "estimate-didnt-happen":
      return { icon: <Flame className="w-4 h-4" />, iconClass: "bg-rose-500/20 text-rose-300" };
    case "setup-call-pending":
      return { icon: <CalendarClock className="w-4 h-4" />, iconClass: "bg-amber-500/20 text-amber-300" };
    case "day-before-confirmation":
      return { icon: <Clock className="w-4 h-4" />, iconClass: "bg-amber-500/20 text-amber-300" };
    case "long-term-reachout-due":
      return { icon: <CalendarClock className="w-4 h-4" />, iconClass: "bg-sky-500/20 text-sky-300" };
    case "ghost-candidate":
      return { icon: <PhoneOff className="w-4 h-4" />, iconClass: "bg-rose-500/20 text-rose-300" };
    case "reschedule-prone":
      return { icon: <AlertTriangle className="w-4 h-4" />, iconClass: "bg-amber-500/20 text-amber-300" };
    default:
      return { icon: <AlertTriangle className="w-4 h-4" />, iconClass: "bg-cc-accent/20 text-cc-accent" };
  }
}
