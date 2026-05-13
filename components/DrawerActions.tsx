"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  PhoneOff,
  Mail,
  MessageSquare,
  Clock,
  Calendar,
  PenLine,
  Trophy,
  XCircle,
  ArrowRight,
  Check,
  Loader2,
} from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ScoredOpportunity, Stage } from "@/lib/types";
import { salesPhase, suggestedNextSalesTouchDate, cappedSmartSnoozeDate } from "@/lib/salesCadence";

interface Props {
  opp: ScoredOpportunity;
  onClose?: () => void;
}

type ToastKind = "success" | "error" | null;

// Canonical lost-reason taxonomy. Picking from a fixed list feeds clean
// win/loss analytics (see WinLossPanel). Add "Other:" prefix to free-text
// for fallback detail capture.
// Calibrated against Jared's actual lost-deal patterns 2026-05-11:
//   - Scope mismatch removed — full on-site consultations mean scope is
//     always clear before estimate goes out
//   - Decided to DIY added — occasional but real pattern
const LOST_REASONS = [
  "Price",
  "Timing",
  "Went with competitor",
  "Decided to DIY",
  "Unresponsive",
  "Other",
] as const;

export function DrawerActions({ opp, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string }>({ kind: null, text: "" });
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [stageOpen, setStageOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState<"Won" | "Lost" | null>(null);
  const [archiveValue, setArchiveValue] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const busy = busyAction !== null || isPending;

  function flash(kind: "success" | "error", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast({ kind: null, text: "" }), 2200);
  }

  async function call(actionName: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyAction(actionName);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash("error", j.error || "Action failed");
        return false;
      }
      flash("success", "Saved");
      startTransition(() => router.refresh());
      return true;
    } catch {
      flash("error", "Network error");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  // Touch + smart-snooze combo. Mirrors OppCard.quickLog exactly so the
  // drawer's "Called (VM)" button behaves the same as the card's quick-log
  // VM button. Without this, clicking VM in the drawer logged the touch
  // but left Next FU stale at today — caught 2026-05-11 with Gus Labao.
  async function quickTouch(type: "Call" | "VM" | "Email" | "Text"): Promise<boolean> {
    setBusyAction(`touch-${type.toLowerCase()}`);
    try {
      const touchRes = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type }),
      });
      if (!touchRes.ok) {
        const j = await touchRes.json().catch(() => ({}));
        flash("error", j.error || "Touch failed");
        return false;
      }
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
        const label = new Date(idealNext + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
        flash("success", `Logged · next FU ${label}`);
      } else {
        flash("success", "Logged");
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      flash("error", "Network error");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2">
          Quick Actions
        </div>

        {/* Touch buttons */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Log touch</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <ActionBtn
              icon={<PhoneOff className="w-3.5 h-3.5" />}
              label="Called (VM)"
              onClick={() => quickTouch("VM")}
              busy={busyAction === "touch-vm"}
              disabled={busy}
            />
            <ActionBtn
              icon={<Phone className="w-3.5 h-3.5" />}
              label="Called (talked)"
              onClick={() => quickTouch("Call")}
              busy={busyAction === "touch-call"}
              disabled={busy}
            />
            <ActionBtn
              icon={<Mail className="w-3.5 h-3.5" />}
              label="Email sent"
              onClick={() => quickTouch("Email")}
              busy={busyAction === "touch-email"}
              disabled={busy}
            />
            <ActionBtn
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              label="Text sent"
              onClick={() => quickTouch("Text")}
              busy={busyAction === "touch-text"}
              disabled={busy}
            />
          </div>
        </div>

        {/* Snooze buttons */}
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            Push next follow-up
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <ActionBtn
              icon={<Clock className="w-3.5 h-3.5" />}
              label="+3 days"
              onClick={() => call("snooze-3", { action: "snooze", days: 3 })}
              busy={busyAction === "snooze-3"}
              disabled={busy}
            />
            <ActionBtn
              icon={<Clock className="w-3.5 h-3.5" />}
              label="+1 week"
              onClick={() => call("snooze-7", { action: "snooze", days: 7 })}
              busy={busyAction === "snooze-7"}
              disabled={busy}
            />
            <ActionBtn
              icon={<Clock className="w-3.5 h-3.5" />}
              label="+2 weeks"
              onClick={() => call("snooze-14", { action: "snooze", days: 14 })}
              busy={busyAction === "snooze-14"}
              disabled={busy}
            />
            <ActionBtn
              icon={<Calendar className="w-3.5 h-3.5" />}
              label="Custom…"
              onClick={() => setSnoozeOpen(true)}
              busy={false}
              disabled={busy}
            />
          </div>
        </div>

        {/* Add Note + Stage */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <ActionBtn
            icon={<PenLine className="w-3.5 h-3.5" />}
            label="Add note"
            onClick={() => setNoteOpen(true)}
            busy={false}
            disabled={busy}
          />
          <ActionBtn
            icon={<ArrowRight className="w-3.5 h-3.5" />}
            label="Change stage"
            onClick={() => setStageOpen(true)}
            busy={false}
            disabled={busy}
          />
        </div>

        {/* Won / Lost (terminal) */}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <ActionBtn
            icon={<Trophy className="w-3.5 h-3.5" />}
            label="Mark Won"
            onClick={() => setArchiveOpen("Won")}
            busy={false}
            disabled={busy}
            tone="emerald"
          />
          <ActionBtn
            icon={<XCircle className="w-3.5 h-3.5" />}
            label="Mark Lost"
            onClick={() => setArchiveOpen("Lost")}
            busy={false}
            disabled={busy}
            tone="rose"
          />
        </div>
      </div>

      {/* Toast */}
      {toast.kind && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-[60] px-4 py-2 rounded-lg shadow-xl text-sm font-medium",
            toast.kind === "success" && "bg-emerald-600 text-white",
            toast.kind === "error" && "bg-rose-600 text-white"
          )}
        >
          {toast.kind === "success" ? "✓ " : "⚠ "}
          {toast.text}
        </div>
      )}

      {/* Note modal */}
      {noteOpen && (
        <Modal title="Add note" onClose={() => setNoteOpen(false)}>
          <textarea
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="What happened? (e.g. 'Called wife, she'll review with husband, FU Tuesday')"
            rows={4}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setNoteOpen(false);
                setNoteText("");
              }}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                const ok = await call("note", { action: "note", text: noteText });
                if (ok) {
                  setNoteOpen(false);
                  setNoteText("");
                }
              }}
              disabled={!noteText.trim() || busy}
              className="px-3 py-1.5 text-sm font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50"
            >
              Add note
            </button>
          </div>
        </Modal>
      )}

      {/* Stage modal */}
      {stageOpen && (
        <Modal title="Change stage" onClose={() => setStageOpen(false)}>
          <div className="space-y-1">
            {(["Proposal Sent", "Verbal Yes", "On Hold", "Long-Term"] as Stage[]).map((s) => (
              <button
                key={s}
                onClick={async () => {
                  // Verbal Yes is a meaningful escalation. Confirm to
                  // prevent the accidental-tap problem caught 2026-05-11
                  // (Stewart + David flipped to Verbal Yes without intent
                  // because modal button text was invisible).
                  if (s === "Verbal Yes" && opp.stage !== "Verbal Yes") {
                    const ok = window.confirm(
                      `Mark ${opp.name} as Verbal Yes? This means the client has verbally committed and you're now in deposit-collection mode (3-day cadence).`
                    );
                    if (!ok) return;
                  }
                  const ok = await call("stage", { action: "stage", newStage: s });
                  if (ok) setStageOpen(false);
                }}
                disabled={busy || s === opp.stage}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm rounded-md border transition font-medium",
                  s === opp.stage
                    ? "bg-zinc-100 border-border text-text-muted cursor-not-allowed"
                    : "bg-white border-border text-text-primary hover:bg-zinc-50"
                )}
              >
                {s} {s === opp.stage && <span className="text-xs text-text-muted">· current</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Snooze custom date modal */}
      {snoozeOpen && (
        <SnoozeCustomModal
          onClose={() => setSnoozeOpen(false)}
          onSave={async (date, fuType) => {
            const ok = await call("snooze-custom", { action: "snooze", date, fuType });
            if (ok) setSnoozeOpen(false);
          }}
          disabled={busy}
        />
      )}

      {/* Won / Lost modal */}
      {archiveOpen && (
        <Modal
          title={archiveOpen === "Won" ? "🎉 Mark as Won" : "❌ Mark as Lost"}
          onClose={() => {
            setArchiveOpen(null);
            setArchiveValue("");
            setArchiveReason("");
          }}
        >
          {archiveOpen === "Won" ? (
            <>
              <label className="block text-xs uppercase tracking-wider text-text-muted font-semibold mb-1">
                Booked Value
              </label>
              <input
                type="number"
                step="0.01"
                autoFocus
                value={archiveValue}
                onChange={(e) => setArchiveValue(e.target.value)}
                placeholder={opp.estValue > 0 ? String(opp.estValue) : "10000.00"}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent tabular-nums"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Defaults to Est Value if you leave blank — but enter the actual booked value if it differs (upsell, change order, etc.).
              </p>
            </>
          ) : (
            <>
              <label className="block text-xs uppercase tracking-wider text-text-muted font-semibold mb-1.5">
                Reason Lost
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {LOST_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setArchiveReason(r)}
                    className={cn(
                      "px-2.5 py-1.5 text-xs font-semibold rounded-md border transition text-left",
                      archiveReason === r
                        ? "bg-cc-navy text-white border-cc-navy"
                        : "bg-white text-text-secondary border-border hover:bg-zinc-50"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <label className="block text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-1 mt-2">
                Details (optional)
              </label>
              <input
                type="text"
                value={archiveReason.startsWith("Other:") ? archiveReason.slice(7).trim() : ""}
                onChange={(e) => setArchiveReason(`Other: ${e.target.value}`)}
                placeholder="e.g. Specific detail or note"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
              />
              <p className="text-[11px] text-text-muted mt-1.5 italic">
                Picking a reason feeds win/loss analysis. Helps spot patterns over time.
              </p>
            </>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setArchiveOpen(null);
                setArchiveValue("");
                setArchiveReason("");
              }}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                const payload: Record<string, unknown> = {
                  action: "archive",
                  result: archiveOpen,
                };
                if (archiveOpen === "Won") {
                  const v = parseFloat(archiveValue);
                  if (!isNaN(v) && v > 0) payload.bookedValue = v;
                  else if (opp.estValue > 0) payload.bookedValue = opp.estValue;
                }
                if (archiveOpen === "Lost" && archiveReason.trim()) {
                  payload.reasonLost = archiveReason.trim();
                }
                const ok = await call("archive", payload);
                if (ok) {
                  setArchiveOpen(null);
                  setArchiveValue("");
                  setArchiveReason("");
                  if (onClose) setTimeout(onClose, 400); // close drawer after archive
                }
              }}
              disabled={busy}
              className={cn(
                "px-3 py-1.5 text-sm font-semibold text-white rounded-md disabled:opacity-50",
                archiveOpen === "Won" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
              )}
            >
              {archiveOpen === "Won" ? "Mark Won + Archive" : "Mark Lost + Archive"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  busy,
  disabled,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone?: "default" | "emerald" | "rose";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-md border transition",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        tone === "default" && "bg-white border-border text-text-primary hover:bg-zinc-50 hover:border-cc-accent/40",
        tone === "emerald" && "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100",
        tone === "rose" && "bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100"
      )}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-xl shadow-2xl border border-border w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-text-primary mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function SnoozeCustomModal({
  onClose,
  onSave,
  disabled,
}: {
  onClose: () => void;
  onSave: (date: string, fuType: "Call" | "Email" | "Text") => void;
  disabled: boolean;
}) {
  const [date, setDate] = useState("");
  const [fuType, setFuType] = useState<"Call" | "Email" | "Text">("Email");
  return (
    <Modal title="Custom follow-up date" onClose={onClose}>
      <label className="block text-xs uppercase tracking-wider text-text-muted font-semibold mb-1">
        Date
      </label>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
      />
      <label className="block text-xs uppercase tracking-wider text-text-muted font-semibold mb-1 mt-3">
        Type
      </label>
      <div className="flex gap-1.5">
        {(["Call", "Email", "Text"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFuType(t)}
            className={cn(
              "flex-1 px-2 py-1.5 text-xs font-semibold rounded-md border transition",
              fuType === t
                ? "bg-cc-navy text-white border-cc-navy"
                : "bg-white text-text-secondary border-border hover:bg-zinc-50"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          onClick={() => date && onSave(date, fuType)}
          disabled={disabled || !date}
          className="px-3 py-1.5 text-sm font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
