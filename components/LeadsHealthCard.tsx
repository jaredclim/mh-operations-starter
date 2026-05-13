"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Snowflake,
  Phone,
  PhoneOff,
  CalendarClock,
  Calendar,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
} from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { LeadsHealth, ScoredLead, LeadStage } from "@/lib/types";
import { LEAD_STAGES } from "@/lib/types";
import { LeadDrawer } from "./LeadDrawer";
import { LeadQuickLog } from "./LeadQuickLog";

interface Props {
  health: LeadsHealth;
  active: ScoredLead[];
}

type ExpandedKey =
  | "callbackDue"
  | "neverReached"
  | "inboundToday"
  | "ghosting"
  | "estimateThisWeek"
  | "setupCallsPending"
  | "longTermReachoutsDue"
  | "stale"
  | LeadStage
  | null;

export function LeadsHealthCard({ health, active }: Props) {
  const [expanded, setExpanded] = useState<ExpandedKey>(null);
  const [openLead, setOpenLead] = useState<ScoredLead | null>(null);
  const today = todayISO();

  function toggle(key: ExpandedKey) {
    setExpanded((cur) => (cur === key ? null : key));
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cc-navy via-cc-navy-deep to-[#02152A] text-white shadow-xl">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 20%, rgba(232,146,60,0.25) 0%, transparent 45%), radial-gradient(circle at 10% 90%, rgba(96,165,250,0.18) 0%, transparent 40%)",
          }}
          aria-hidden
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 p-6 sm:p-8">
          {/* Total active */}
          <div className="flex flex-col justify-center">
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              Active leads
            </div>
            <div className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums">
              {health.activeCount}
            </div>
            <div className="mt-2 text-sm text-white/70">
              Pre-estimate (excludes Lost)
            </div>
            <div className="mt-3 text-[11px] text-white/40 max-w-[28ch]">
              Once you add the opportunity to Pipeline, the lead auto-archives from here.
            </div>
          </div>

          {/* Stage distribution */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              By stage
            </div>
            <StageBars
              byStage={health.byStage}
              activeCount={health.activeCount}
              expanded={expanded}
              onToggle={(s) => toggle(s)}
            />
          </div>

          {/* Attention column */}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              Needs attention
            </div>
            <ClickableStat
              icon={<Phone className="w-4 h-4 text-rose-300" />}
              label="Callback due"
              count={health.callbackDue}
              expanded={expanded === "callbackDue"}
              onClick={() => toggle("callbackDue")}
            />
            <ClickableStat
              icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}
              label="Never reached"
              count={health.neverReached}
              expanded={expanded === "neverReached"}
              onClick={() => toggle("neverReached")}
            />
            <ClickableStat
              icon={<Zap className="w-4 h-4 text-amber-300" />}
              label="Inbound today"
              count={health.inboundToday}
              expanded={expanded === "inboundToday"}
              onClick={() => toggle("inboundToday")}
            />
            <ClickableStat
              icon={<PhoneOff className="w-4 h-4 text-rose-300" />}
              label="Ghosting"
              count={health.ghosting}
              expanded={expanded === "ghosting"}
              onClick={() => toggle("ghosting")}
            />
            <ClickableStat
              icon={<Calendar className="w-4 h-4 text-emerald-300" />}
              label="Estimate this week"
              count={health.estimateThisWeek}
              expanded={expanded === "estimateThisWeek"}
              onClick={() => toggle("estimateThisWeek")}
            />
            <ClickableStat
              icon={<CalendarClock className="w-4 h-4 text-amber-300" />}
              label="Setup calls pending"
              count={health.setupCallsPending}
              expanded={expanded === "setupCallsPending"}
              onClick={() => toggle("setupCallsPending")}
            />
            <ClickableStat
              icon={<Snowflake className="w-4 h-4 text-sky-300" />}
              label="Long-term reach-outs due"
              count={health.longTermReachoutsDue}
              expanded={expanded === "longTermReachoutsDue"}
              onClick={() => toggle("longTermReachoutsDue")}
            />
            <ClickableStat
              icon={<Clock className="w-4 h-4 text-slate-300" />}
              label="Stale (>14d no touch)"
              count={health.stale}
              expanded={expanded === "stale"}
              onClick={() => toggle("stale")}
            />
          </div>
        </div>

        {/* Expanded panel */}
        {expanded && (
          <div className="relative border-t border-white/10 bg-black/15 backdrop-blur-sm px-6 sm:px-8 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-[0.2em] text-cc-accent font-semibold">
                {expandedLabel(expanded)}
              </h3>
              <button
                onClick={() => setExpanded(null)}
                className="text-white/60 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ExpandedList
              leads={listFor(expanded, health, active, today)}
              onOpen={(lead) => setOpenLead(lead)}
              statKey={expanded}
            />
          </div>
        )}
      </section>
      {openLead && <LeadDrawer lead={openLead} open={true} onClose={() => setOpenLead(null)} />}
    </>
  );
}

function listFor(key: ExpandedKey, health: LeadsHealth, active: ScoredLead[], today: string): ScoredLead[] {
  if (!key) return [];
  if ((LEAD_STAGES as string[]).includes(key as string)) {
    return active.filter((l) => l.stage === key);
  }
  switch (key) {
    case "callbackDue":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "callback-due" && s.severity === "rose"));
    case "neverReached":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "never-reached"));
    case "inboundToday":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "inbound-today"));
    case "ghosting":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "ghost-candidate"));
    case "estimateThisWeek":
      return active.filter((l) => {
        if (l.stage !== "Estimate booked" || !l.estimateVisitDate) return false;
        const d = Math.round((new Date(l.estimateVisitDate + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000);
        return d >= 0 && d <= 7;
      });
    case "setupCallsPending":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "setup-call-pending"));
    case "longTermReachoutsDue":
      return active.filter((l) => l.staleSignals.some((s) => s.key === "long-term-reachout-due"));
    case "stale":
      return active.filter((l) => {
        if (!l.lastTouchDate || l.stage === "Long-term hold") return false;
        const d = Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(l.lastTouchDate + "T12:00:00Z").getTime()) / 86400000);
        return d > 14;
      });
    default:
      return [];
  }
}

function expandedLabel(key: ExpandedKey): string {
  if ((LEAD_STAGES as string[]).includes(key as string)) return `${key} leads`;
  const map: Record<string, string> = {
    callbackDue: "Callbacks due",
    neverReached: "Never reached (first-touch SLA blown)",
    inboundToday: "Inbound today",
    ghosting: "Ghosting (3+ attempts, no reply)",
    estimateThisWeek: "Estimate visits this week",
    setupCallsPending: "Setup calls pending",
    longTermReachoutsDue: "Long-term reach-outs due",
    stale: "Stale (>14 days no touch)",
  };
  return map[key as string] || "";
}

function ClickableStat({
  icon,
  label,
  count,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  expanded: boolean;
  onClick: () => void;
}) {
  const hasItems = count > 0;
  return (
    <button
      onClick={onClick}
      disabled={!hasItems}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-2 py-1 -mx-2 rounded-md transition text-left",
        hasItems ? "hover:bg-white/8 cursor-pointer" : "cursor-default opacity-60"
      )}
    >
      <div className="flex items-center gap-2 text-sm text-white/80 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-base font-semibold tabular-nums", hasItems ? "text-white" : "text-white/60")}>
          {count}
        </span>
        {hasItems && (
          <span className="text-white/40">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        )}
      </div>
    </button>
  );
}

function ExpandedList({
  leads,
  onOpen,
  statKey,
}: {
  leads: ScoredLead[];
  onOpen: (lead: ScoredLead) => void;
  statKey: ExpandedKey;
}) {
  if (leads.length === 0) {
    return <p className="text-sm text-white/60 italic">No leads in this category.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {leads.map((lead) => {
        const id = lead.id || lead.name;
        return (
          <li
            key={id}
            className="bg-white/8 rounded-lg px-3 py-2 flex items-center gap-3 hover:bg-white/12 transition cursor-pointer"
            onClick={() => onOpen(lead)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-sm truncate">{lead.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-cc-accent shrink-0">
                  {lead.stage}
                </span>
              </div>
              <div className="text-[11px] text-white/60 truncate">
                {lead.priorityReasons[0] || (lead.lastTouchDate ? `last touch ${lead.lastTouchDate}` : "never reached")}
                {statKey === "callbackDue" && lead.callbackTime && ` · ${lead.callbackTime}`}
                {statKey === "estimateThisWeek" && lead.estimateVisitDate && ` · visit ${lead.estimateVisitDate}`}
                {statKey === "longTermReachoutsDue" && lead.longTermReachOutDate && ` · reach-out ${lead.longTermReachOutDate}`}
              </div>
            </div>
            <LeadQuickLog lead={lead} />
          </li>
        );
      })}
    </ul>
  );
}

function StageBars({
  byStage,
  activeCount,
  expanded,
  onToggle,
}: {
  byStage: Record<LeadStage, number>;
  activeCount: number;
  expanded: ExpandedKey;
  onToggle: (s: LeadStage) => void;
}) {
  const stages: LeadStage[] = ["New", "Attempted contact", "Callback requested", "Estimate booked", "Long-term hold"];
  const colors: Record<LeadStage, string> = {
    "New": "bg-sky-400",
    "Attempted contact": "bg-amber-400",
    "Callback requested": "bg-rose-400",
    "Estimate booked": "bg-emerald-400",
    "Long-term hold": "bg-slate-400",
    "Lost": "bg-zinc-500",
  };
  const total = activeCount || 1;
  return (
    <div className="mt-3 space-y-3">
      <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
        {stages.map((s) => {
          const count = byStage[s] || 0;
          const pct = (count / total) * 100;
          return <div key={s} className={colors[s]} style={{ width: `${pct}%` }} title={`${s}: ${count}`} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
        {stages.map((s) => {
          const count = byStage[s] || 0;
          const isExpanded = expanded === s;
          const hasItems = count > 0;
          return (
            <button
              key={s}
              onClick={() => hasItems && onToggle(s)}
              disabled={!hasItems}
              className={cn(
                "flex items-center justify-between px-1.5 py-1 -mx-1.5 rounded-md transition",
                hasItems ? "hover:bg-white/8 cursor-pointer" : "cursor-default opacity-60",
                isExpanded && "bg-white/10"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", colors[s])} aria-hidden />
                <span className="text-white/80 truncate">{s}</span>
              </div>
              <div className="tabular-nums text-white/60 text-xs flex items-center gap-1 shrink-0">
                <span className="font-semibold text-white/90">{count}</span>
                {hasItems && (
                  <span className="text-white/40 ml-0.5">
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
