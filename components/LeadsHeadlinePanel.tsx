"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LeadsHeadline, ScoredLead } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LeadDrawer } from "./LeadDrawer";
import { LeadQuickLog } from "./LeadQuickLog";

interface Props {
  headline: LeadsHeadline;
}

const TONE_STYLES: Record<LeadsHeadline["tone"], { container: string; chevron: string; expandedBg: string }> = {
  danger: {
    container: "bg-rose-50 border-rose-200 text-rose-900",
    chevron: "text-rose-700",
    expandedBg: "bg-rose-50/60 border-t border-rose-200",
  },
  warning: {
    container: "bg-amber-50 border-amber-200 text-amber-900",
    chevron: "text-amber-700",
    expandedBg: "bg-amber-50/60 border-t border-amber-200",
  },
  good: {
    container: "bg-emerald-50 border-emerald-200 text-emerald-900",
    chevron: "text-emerald-700",
    expandedBg: "bg-emerald-50/60 border-t border-emerald-200",
  },
  neutral: {
    container: "bg-slate-50 border-slate-200 text-slate-700",
    chevron: "text-slate-600",
    expandedBg: "bg-slate-50/60 border-t border-slate-200",
  },
};

export function LeadsHeadlinePanel({ headline }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [openLead, setOpenLead] = useState<ScoredLead | null>(null);
  const styles = TONE_STYLES[headline.tone];
  const hasItems = headline.relatedLeads.length > 0;

  return (
    <>
      <div className={cn("rounded-xl border overflow-hidden", styles.container)}>
        <button
          onClick={() => hasItems && setExpanded((v) => !v)}
          disabled={!hasItems}
          className={cn(
            "w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-sm sm:text-[15px] font-medium text-left transition",
            hasItems ? "hover:bg-black/[0.03] cursor-pointer" : "cursor-default"
          )}
        >
          <span className="text-xl sm:text-2xl shrink-0" aria-hidden>
            {headline.emoji}
          </span>
          <span className="leading-snug flex-1">{headline.text}</span>
          {hasItems && (
            <span className={cn("shrink-0", styles.chevron)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          )}
        </button>
        {expanded && hasItems && (
          <div className={cn("px-4 sm:px-5 py-3 space-y-1.5", styles.expandedBg)}>
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-70 mb-1">
              {headline.relatedLabel}
            </div>
            {headline.relatedLeads.map((lead) => (
              <div
                key={lead.id || lead.name}
                className="bg-white/70 border border-current/10 rounded-md px-3 py-1.5 flex items-center gap-3 hover:bg-white transition cursor-pointer"
                onClick={() => setOpenLead(lead)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-text-primary truncate">{lead.name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-cc-navy shrink-0">
                      {lead.stage}
                    </span>
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {lead.priorityReasons[0] ||
                      (lead.lastTouchDate ? `last touch ${lead.lastTouchDate}` : "never reached")}
                  </div>
                </div>
                <LeadQuickLog lead={lead} />
              </div>
            ))}
          </div>
        )}
      </div>
      {openLead && <LeadDrawer lead={openLead} open={true} onClose={() => setOpenLead(null)} />}
    </>
  );
}
