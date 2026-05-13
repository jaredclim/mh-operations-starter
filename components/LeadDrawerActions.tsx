"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Mail, MessageSquare, Check, CalendarClock, RefreshCw, XCircle, ChevronRight, Calendar } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ScoredLead, LeadStage, LeadLostReason } from "@/lib/types";
import { LEAD_LOST_REASONS } from "@/lib/types";
import { leadsPhase, suggestedNextLeadTouchDate } from "@/lib/leadsCadence";

interface Props {
  lead: ScoredLead;
  onClose: () => void;
}

/**
 * The drawer's action region. Three rows:
 *   1. Quick-log (Call/VM/Text/Email) — primary touches
 *   2. Stage-specific actions:
 *       - Estimate booked → Mark setup call done · Reschedule visit
 *       - Long-term hold → Update reach-out date
 *       - All → Change stage
 *   3. Lost button (with reason picklist) — destructive, separated
 */
export function LeadDrawerActions({ lead, onClose }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [showLostMenu, setShowLostMenu] = useState(false);
  const [showRescheduleInput, setShowRescheduleInput] = useState(false);
  const [showReachOutInput, setShowReachOutInput] = useState(false);
  const [showCallbackInput, setShowCallbackInput] = useState(false);
  const [reschedDate, setReschedDate] = useState("");
  const [reachOutDate, setReachOutDate] = useState("");
  const [callbackTime, setCallbackTime] = useState("");

  async function post(body: object): Promise<boolean> {
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return !!json.ok;
    } catch {
      return false;
    }
  }

  async function quickLog(type: "Call" | "VM" | "Email" | "Text") {
    setBusy(type);
    try {
      await post({ leadId: lead.id, action: "touch", type });
      const today = todayISO();
      const phase = leadsPhase(lead);
      const currentNext = lead.nextTouchDate;
      const ideal = suggestedNextLeadTouchDate(lead, today, today);
      let shouldAdjust = false;
      if (!currentNext) shouldAdjust = true;
      else {
        const daysToCurrent = Math.round(
          (new Date(currentNext + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000
        );
        if (daysToCurrent < phase.minGapFromLast || daysToCurrent > phase.maxGapDays) shouldAdjust = true;
      }
      if (shouldAdjust) {
        await post({ leadId: lead.id, action: "snooze", date: ideal });
      }
      setRecent(type);
      setTimeout(() => setRecent(null), 1800);
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function changeStage(newStage: Exclude<LeadStage, "Lost">, extra: object = {}) {
    setBusy(newStage);
    try {
      const ok = await post({ leadId: lead.id, action: "stage", newStage, ...extra });
      if (ok) {
        setShowStageMenu(false);
        setShowReachOutInput(false);
        setShowCallbackInput(false);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleSetupCall() {
    setBusy("setup");
    try {
      const ok = await post({ leadId: lead.id, action: "setup-call", done: !lead.setupCallDone });
      if (ok) startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function doReschedule() {
    if (!reschedDate) return;
    setBusy("reschedule");
    try {
      const ok = await post({ leadId: lead.id, action: "reschedule", newDate: reschedDate });
      if (ok) {
        setShowRescheduleInput(false);
        setReschedDate("");
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(null);
    }
  }

  async function archiveLost(reason: LeadLostReason) {
    setBusy("lost");
    try {
      const ok = await post({ leadId: lead.id, action: "lost", reason });
      if (ok) {
        setShowLostMenu(false);
        startTransition(() => router.refresh());
        onClose();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-2">
        Log touch
      </div>
      {/* Row 1 — Quick log */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {lead.phone && (
          <>
            <ActionBtn
              icon={<Phone className="w-3.5 h-3.5" />}
              label="Call"
              accent
              busy={busy === "Call"}
              done={recent === "Call"}
              onClick={() => quickLog("Call")}
            />
            <ActionBtn
              icon={<PhoneOff className="w-3.5 h-3.5" />}
              label="VM"
              busy={busy === "VM"}
              done={recent === "VM"}
              onClick={() => quickLog("VM")}
            />
            <ActionBtn
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              label="Text"
              busy={busy === "Text"}
              done={recent === "Text"}
              onClick={() => quickLog("Text")}
            />
          </>
        )}
        {lead.email && (
          <ActionBtn
            icon={<Mail className="w-3.5 h-3.5" />}
            label="Email"
            busy={busy === "Email"}
            done={recent === "Email"}
            onClick={() => quickLog("Email")}
          />
        )}
      </div>

      {/* Row 2 — Stage-specific */}
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-2">
        Status
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {lead.stage === "Estimate booked" && (
          <>
            <ActionBtn
              icon={<Check className="w-3.5 h-3.5" />}
              label={lead.setupCallDone ? "Setup undo" : "Mark setup done"}
              busy={busy === "setup"}
              onClick={toggleSetupCall}
            />
            <ActionBtn
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              label="Reschedule"
              onClick={() => setShowRescheduleInput((v) => !v)}
            />
          </>
        )}
        <div className="relative">
          <ActionBtn
            icon={<ChevronRight className="w-3.5 h-3.5" />}
            label="Change stage"
            onClick={() => setShowStageMenu((v) => !v)}
          />
          {showStageMenu && (
            <div className="absolute top-full left-0 mt-1 z-10 min-w-[200px] bg-white border border-border rounded-lg shadow-lg p-1">
              <StageOption
                label="New"
                current={lead.stage === "New"}
                onClick={() => changeStage("New")}
              />
              <StageOption
                label="Attempted contact"
                current={lead.stage === "Attempted contact"}
                onClick={() => changeStage("Attempted contact")}
              />
              <StageOption
                label="Callback requested"
                current={lead.stage === "Callback requested"}
                onClick={() => {
                  setShowCallbackInput(true);
                  setShowStageMenu(false);
                }}
              />
              <StageOption
                label="Estimate booked"
                current={lead.stage === "Estimate booked"}
                onClick={() => {
                  setShowRescheduleInput(true);
                  setShowStageMenu(false);
                }}
              />
              <StageOption
                label="Long-term hold"
                current={lead.stage === "Long-term hold"}
                onClick={() => {
                  setShowReachOutInput(true);
                  setShowStageMenu(false);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Reschedule input */}
      {showRescheduleInput && (
        <div className="mb-3 flex items-center gap-2 p-3 bg-zinc-50 border border-border rounded-lg">
          <Calendar className="w-4 h-4 text-text-muted shrink-0" />
          <input
            type="date"
            value={reschedDate}
            onChange={(e) => setReschedDate(e.target.value)}
            min={todayISO()}
            className="flex-1 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-cc-accent"
          />
          <button
            onClick={lead.stage === "Estimate booked" ? doReschedule : () => changeStage("Estimate booked", { estimateVisitDate: reschedDate })}
            disabled={!reschedDate || busy === "reschedule"}
            className="px-3 py-1 text-xs font-semibold bg-cc-navy text-white rounded hover:bg-cc-navy-deep disabled:opacity-50"
          >
            {lead.stage === "Estimate booked" ? "Reschedule" : "Book visit"}
          </button>
          <button
            onClick={() => setShowRescheduleInput(false)}
            className="text-text-muted hover:text-text-primary text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Callback time input */}
      {showCallbackInput && (
        <div className="mb-3 flex items-center gap-2 p-3 bg-zinc-50 border border-border rounded-lg">
          <CalendarClock className="w-4 h-4 text-text-muted shrink-0" />
          <input
            type="text"
            value={callbackTime}
            onChange={(e) => setCallbackTime(e.target.value)}
            placeholder="e.g. Mon 3pm, or 2026-05-14T15:00"
            className="flex-1 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-cc-accent"
          />
          <button
            onClick={() => changeStage("Callback requested", { callbackTime })}
            disabled={!callbackTime.trim()}
            className="px-3 py-1 text-xs font-semibold bg-cc-navy text-white rounded hover:bg-cc-navy-deep disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setShowCallbackInput(false)} className="text-text-muted hover:text-text-primary text-sm">
            Cancel
          </button>
        </div>
      )}

      {/* Long-term reach-out input — required modal-ish */}
      {showReachOutInput && (
        <div className="mb-3 p-3 bg-zinc-50 border border-border rounded-lg space-y-2">
          <div className="text-sm font-semibold text-text-primary">When does the client want to be reached?</div>
          <div className="text-[12px] text-text-secondary">Long-term hold = next calendar year+. Pick a date or use a preset.</div>
          <div className="flex flex-wrap gap-1.5">
            <Preset label="Spring next year" onClick={() => setReachOutDate(nextYearDate(3, 1))} active={reachOutDate === nextYearDate(3, 1)} />
            <Preset label="Summer next year" onClick={() => setReachOutDate(nextYearDate(6, 1))} active={reachOutDate === nextYearDate(6, 1)} />
            <Preset label="Fall next year" onClick={() => setReachOutDate(nextYearDate(9, 1))} active={reachOutDate === nextYearDate(9, 1)} />
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-text-muted shrink-0" />
            <input
              type="date"
              value={reachOutDate}
              onChange={(e) => setReachOutDate(e.target.value)}
              min={todayISO()}
              className="flex-1 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-cc-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowReachOutInput(false)} className="text-text-muted hover:text-text-primary text-sm">
              Cancel
            </button>
            <button
              onClick={() => changeStage("Long-term hold", { longTermReachOutDate: reachOutDate })}
              disabled={!reachOutDate}
              className="px-3 py-1 text-xs font-semibold bg-cc-navy text-white rounded hover:bg-cc-navy-deep disabled:opacity-50"
            >
              Move to Long-term hold
            </button>
          </div>
        </div>
      )}

      {/* Row 3 — Lost */}
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-2">
        Archive
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowLostMenu((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-md transition"
        >
          <XCircle className="w-3.5 h-3.5" />
          Mark as lost
        </button>
        {showLostMenu && (
          <div className="absolute top-full left-0 mt-1 z-10 min-w-[220px] bg-white border border-border rounded-lg shadow-lg p-1">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-text-muted border-b border-border">
              Why lost?
            </div>
            {LEAD_LOST_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => archiveLost(r)}
                disabled={busy === "lost"}
                className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-rose-50 hover:text-rose-700 rounded transition"
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionBtn({
  icon,
  label,
  busy,
  done,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  done?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition",
        done
          ? "bg-emerald-100 border-emerald-300 text-emerald-800"
          : accent
            ? "bg-cc-navy border-cc-navy text-white hover:bg-cc-navy-deep"
            : "bg-white border-border text-text-secondary hover:bg-zinc-50 hover:border-cc-accent/40",
        busy && "opacity-50 cursor-wait"
      )}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : icon}
      {label}
    </button>
  );
}

function StageOption({ label, current, onClick }: { label: string; current: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={current}
      className={cn(
        "w-full text-left px-3 py-1.5 text-sm rounded transition",
        current
          ? "bg-cc-accent/15 text-cc-navy font-semibold cursor-default"
          : "text-text-secondary hover:bg-zinc-50 hover:text-text-primary"
      )}
    >
      {label}
      {current && <span className="text-[10px] ml-2 text-text-muted">current</span>}
    </button>
  );
}

function Preset({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-[11px] font-semibold rounded border transition",
        active
          ? "bg-cc-accent/15 border-cc-accent text-cc-navy"
          : "bg-white border-border text-text-secondary hover:bg-zinc-50"
      )}
    >
      {label}
    </button>
  );
}

function nextYearDate(month: number, day: number): string {
  const now = new Date();
  const ny = now.getFullYear() + 1;
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${ny}-${m}-${d}`;
}
