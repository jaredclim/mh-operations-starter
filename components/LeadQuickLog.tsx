"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Mail, MessageSquare, Check } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { Lead } from "@/lib/types";
import { leadsPhase, suggestedNextLeadTouchDate } from "@/lib/leadsCadence";

/**
 * Shared 4-channel quick-log button row for Leads dashboard surfaces.
 * Mirrors HeadlinePanel.QuickLogChannels from the Pipeline dashboard.
 * Used in: LeadsHealthCard expanded rows, LeadsHeadlinePanel expanded rows.
 *
 * Each tap: log touch → smart-adjust next-touch (only if out of cadence).
 */
export function LeadQuickLog({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);

  async function quickLog(type: "Call" | "VM" | "Email" | "Text", e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(type);
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
          (new Date(currentNext + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000
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
      {lead.phone && (
        <>
          <Btn icon={<Phone className="w-3 h-3" />} label="Call" busy={busy === "Call"} done={recent === "Call"} onClick={(e) => quickLog("Call", e)} />
          <Btn icon={<PhoneOff className="w-3 h-3" />} label="VM" busy={busy === "VM"} done={recent === "VM"} onClick={(e) => quickLog("VM", e)} />
          <Btn icon={<MessageSquare className="w-3 h-3" />} label="Text" busy={busy === "Text"} done={recent === "Text"} onClick={(e) => quickLog("Text", e)} />
        </>
      )}
      {lead.email && (
        <Btn icon={<Mail className="w-3 h-3" />} label="Email" busy={busy === "Email"} done={recent === "Email"} onClick={(e) => quickLog("Email", e)} />
      )}
    </div>
  );
}

function Btn({
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
