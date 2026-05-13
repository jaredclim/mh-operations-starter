"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Phone, PhoneOff, Mail, MessageSquare, Flame, Check } from "lucide-react";
import type { Headline } from "@/lib/insights";
import type { ScoredOpportunity } from "@/lib/types";
import { cn, formatCurrency, todayISO } from "@/lib/utils";
import { OppDrawer } from "./OppDrawer";
import { salesPhase, suggestedNextSalesTouchDate, cappedSmartSnoozeDate } from "@/lib/salesCadence";

interface Props {
  headline: Headline;
}

const TONE_STYLES: Record<Headline["tone"], { container: string; chevron: string; expandedBg: string }> = {
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

export function HeadlinePanel({ headline }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [openOpp, setOpenOpp] = useState<ScoredOpportunity | null>(null);
  const styles = TONE_STYLES[headline.tone];
  const hasItems = headline.relatedOpps.length > 0;

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
            {headline.relatedOpps.map((opp) => (
              <HeadlineOppRow key={opp.id || opp.name} opp={opp} onOpenDrawer={() => setOpenOpp(opp)} />
            ))}
          </div>
        )}
      </div>
      {openOpp && <OppDrawer opp={openOpp} open={true} onClose={() => setOpenOpp(null)} />}
    </>
  );
}

function HeadlineOppRow({
  opp,
  onOpenDrawer,
}: {
  opp: ScoredOpportunity;
  onOpenDrawer: () => void;
}) {
  return (
    <div
      className="bg-white/70 border border-current/10 rounded-md px-3 py-1.5 flex items-center gap-3 hover:bg-white transition cursor-pointer"
      onClick={onOpenDrawer}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          {opp.promise && <Flame className="w-3 h-3 text-rose-600 shrink-0" />}
          <span className="font-semibold text-sm text-text-primary truncate">{opp.name}</span>
          {opp.estValue > 0 && (
            <span className="text-[11px] font-bold text-cc-navy tabular-nums shrink-0">
              {formatCurrency(opp.estValue).replace(/\.00$/, "")}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {opp.stage}
          {opp.promisedTime && ` · promised by ${opp.promisedTime}`}
          {!opp.promisedTime && opp.nextFollowUpDate && ` · FU ${opp.nextFollowUpDate}`}
          {!opp.promisedTime && !opp.nextFollowUpDate && opp.lastTouchDate && ` · last touch ${opp.lastTouchDate}`}
        </div>
      </div>
      <QuickLogChannels opp={opp} />
    </div>
  );
}

/**
 * 4-channel quick-log button row (Call / VM / Text / Email). Logs the
 * touch + smart-adjusts next-FU only if out of cadence range. Reused
 * across HeadlinePanel + PipelineHealthCard expanded rows.
 */
export function QuickLogChannels({ opp }: { opp: ScoredOpportunity }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);

  async function quickLog(type: "Call" | "VM" | "Email" | "Text", e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(type);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type }),
      });
      // Smart next-FU adjustment — same logic as OppCard.quickLog,
      // with Verbal Yes / Promise cap so hot leads don't get snoozed too far.
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
      setRecent(type);
      setTimeout(() => setRecent(null), 1800);
      startTransition(() => router.refresh());
    } catch {
      // silent
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
      {opp.phone && (
        <>
          <ChannelBtn icon={<Phone className="w-3 h-3" />} label="Call" busy={busy === "Call"} done={recent === "Call"} onClick={(e) => quickLog("Call", e)} />
          <ChannelBtn icon={<PhoneOff className="w-3 h-3" />} label="VM" busy={busy === "VM"} done={recent === "VM"} onClick={(e) => quickLog("VM", e)} />
          <ChannelBtn icon={<MessageSquare className="w-3 h-3" />} label="Text" busy={busy === "Text"} done={recent === "Text"} onClick={(e) => quickLog("Text", e)} />
        </>
      )}
      {opp.email && (
        <ChannelBtn icon={<Mail className="w-3 h-3" />} label="Email" busy={busy === "Email"} done={recent === "Email"} onClick={(e) => quickLog("Email", e)} />
      )}
    </div>
  );
}

function ChannelBtn({
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
        "inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md border transition",
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
