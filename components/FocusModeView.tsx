"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  PhoneOff,
  MessageSquare,
  Mail,
  StickyNote,
  SkipForward,
  Flame,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Sparkles,
  Layers,
  TrendingUp,
  Undo2,
  Timer,
  ArrowLeft,
  XCircle,
  Clock3,
} from "lucide-react";
import { cn, formatCurrency, todayISO } from "@/lib/utils";
import type { FocusQueueItem, FocusScope } from "@/lib/focusQueue";
import { salesPhase, suggestedNextSalesTouchDate, cappedSmartSnoozeDate } from "@/lib/salesCadence";
import type { ScoredOpportunity } from "@/lib/types";

interface Props {
  initialQueue: FocusQueueItem[];
  scope: FocusScope;
  today: string;
}

/**
 * Call disposition — captured after a Call press. Drives smart-snooze
 * differently per outcome. Borrowed from Apollo/Salesloft/Outreach
 * pattern (2026-05-11 research):
 *   - Spoke = Connected. Use phase cadence (normal advance).
 *   - Left VM = Not connected. Use phase cadence (touch still counts).
 *   - No answer = Not connected. Snooze 1 day. Don't burn cadence.
 *   - Busy = Not connected. Snooze ~4 hours (same-day retry).
 *   - Wrong number = Bad data. Flag in notes, no auto-FU advance.
 */
type CallDisposition = "Spoke" | "Left VM" | "No answer" | "Busy" | "Wrong number";

const DISPOSITION_DEFAULTS: Record<CallDisposition, { snoozeDays: number | null; touchType: "Call" | "VM"; flagNote?: string }> = {
  "Spoke": { snoozeDays: null, touchType: "Call" }, // null = use phase cadence
  "Left VM": { snoozeDays: null, touchType: "VM" }, // null = use phase cadence
  "No answer": { snoozeDays: 1, touchType: "Call" },
  "Busy": { snoozeDays: 0, touchType: "Call" }, // same day later
  "Wrong number": { snoozeDays: null, touchType: "Call", flagNote: "⚠ Wrong number — needs data fix" },
};

type ActionRecord = {
  cursor: number;
  type: "Call" | "VM" | "Email" | "Text" | "Note" | "Skip";
  disposition?: CallDisposition;
  detail?: string;
  leadName: string;
  leadId?: string;          // Used by undo for server-side revert
  snapshot?: {              // Pre-action state for server-side revert
    lastTouchDate?: string;
    lastTouchType?: string;
    nextFollowUpDate?: string;
    callAttempts?: number;
    notes?: string;
  };
};

function snapshotOpp(opp: { lastTouchDate: string | null; lastTouchType: string; nextFollowUpDate: string | null; callAttempts: number | null; notes: string }) {
  return {
    lastTouchDate: opp.lastTouchDate ?? "",
    lastTouchType: opp.lastTouchType ?? "",
    nextFollowUpDate: opp.nextFollowUpDate ?? "",
    callAttempts: opp.callAttempts ?? 0,
    notes: opp.notes ?? "",
  };
}

/**
 * Focus Mode V5 — World-class CRM focus mode (research-informed 2026-05-11).
 *
 * Synthesized from help docs of Outreach.io, Salesloft, Apollo.io, HubSpot,
 * Pipedrive, Salesforce, Close.com, GoHighLevel, Gong Engage. Implements
 * the universal patterns:
 *   - Disposition capture after Call (Apollo's 9-disposition pattern, simplified to 5)
 *   - Disposition routes the cadence (Connected vs Not-connected)
 *   - Touch-history micro-timeline (6 dots, last 6 touches)
 *   - Live promise countdown when promise active
 *   - Session log footer (last 3 actions)
 *   - Previous button (Gong) separate from Undo
 *   - Auto-advance with celebratory animation
 */
export function FocusModeView({ initialQueue, scope, today }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [queue] = useState<FocusQueueItem[]>(initialQueue);
  const [cursor, setCursor] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Set of action labels completed on the CURRENT card (persists until advance).
  // Lets Jared log multiple touches (Call+Text+Email) before pressing Next.
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  // Tracks the last disposition picked for the Call button label
  const [lastDispositionLabel, setLastDispositionLabel] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  // Optional Next-FU date paired with the note. When set, saving the
  // note ALSO snoozes NFU to that date — one save = note + cadence
  // shift (per Jared 2026-05-12). Chip-based picker shows in the note
  // panel: No date / Today / +3d / +7d / +14d / Custom.
  const [noteDate, setNoteDate] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionRecord[]>([]);
  const [sessionStartMs] = useState<number>(() => Date.now());
  const [, setTick] = useState(0);
  const [dispositionOpen, setDispositionOpen] = useState(false);

  // Tick every second for promise countdown + timer
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const total = queue.length;
  const current = cursor < total ? queue[cursor] : null;
  const nextUp = cursor + 1 < total ? queue[cursor + 1] : null;
  const opp = current?.opp;

  const elapsedMs = Date.now() - sessionStartMs;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const avgSeconds = completed > 0 ? Math.round((elapsedMs / 1000) / completed) : 0;

  function advance(record?: ActionRecord) {
    if (record) setHistory((h) => [...h, record]);
    setCursor((c) => c + 1);
    setNoteOpen(false);
    setNoteText("");
    setDispositionOpen(false);
    setCompletedActions(new Set());
    setLastDispositionLabel(null);
  }

  // "Next" button — advances after a session of touches. Logs a synthetic
  // history record so undo can re-show the card if Jared changes his mind.
  function nextCard() {
    if (!opp) return;
    if (completedActions.size === 0) {
      // Treat as skip — no record needed beyond cursor advance + skip count
      setSkipped((s) => s + 1);
      advance({ cursor, type: "Skip", leadName: opp.name });
      return;
    }
    // At least one action was logged — advance without a separate record
    // (each individual action already pushed its own history entry)
    advance();
  }

  // The Call button opens the disposition picker — for logging the call
  // Jared makes on his actual phone. NO tel: link fire — without softphone
  // recording/transcription, computer-side dial is theater. Phone number is
  // displayed on the card so Jared dials manually on his iPhone.
  function pressCall() {
    if (!opp) return;
    setDispositionOpen(true);
  }

  async function logDispositioned(disposition: CallDisposition) {
    if (!opp) return;
    setBusy("Call");
    setDispositionOpen(false);
    const config = DISPOSITION_DEFAULTS[disposition];
    const preState = snapshotOpp(opp); // Capture for undo
    try {
      // Log the touch using the right type (Spoke→Call, Left VM→VM, etc.)
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type: config.touchType }),
      });

      // Add disposition flag note if needed
      if (config.flagNote) {
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "note", text: `${config.flagNote} (Disposition: ${disposition})` }),
        });
      } else {
        // Otherwise log a brief disposition note for the audit trail
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "note", text: `Call → ${disposition}` }),
        });
      }

      // Smart snooze routing
      if (config.snoozeDays !== null) {
        // Explicit short-snooze override (No answer = +1d, Busy = today)
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "snooze", days: config.snoozeDays, fuType: "Call" }),
        });
      } else if (disposition !== "Wrong number") {
        // Use phase cadence (Spoke / Left VM) — capped so VY/promise leads
        // don't push 14 days out and vanish (Stewart Whitfield bug pattern).
        const phase = salesPhase(opp, today);
        const currentNextFu = opp.nextFollowUpDate;
        const idealNext = cappedSmartSnoozeDate(opp, today, suggestedNextSalesTouchDate(opp, today, today));
        let shouldAdjust = false;
        if (!currentNextFu) shouldAdjust = true;
        else {
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
      }
      // Wrong number = no auto-FU. Leaves the data quality flag for Jared to fix.

      // Mark Call done; stay on card so Jared can also log Text/Email/etc
      setCompletedActions((s) => new Set(s).add("Call"));
      setLastDispositionLabel(disposition);
      setCompleted((c) => c + 1);
      // Push history entry so Undo can revert this single action
      setHistory((h) => [...h, {
        cursor,
        type: "Call",
        disposition,
        leadName: opp.name,
        leadId: opp.id,
        snapshot: preState,
      }]);
    } catch {
      // silent
    } finally {
      setBusy(null);
    }
  }

  // Non-Call touches (VM/Text/Email) — LOG ONLY, no app launch.
  // Focus Mode buttons are LOGGERS, not initiators. Per Jared's workflow:
  //   - Emails: pre-drafted by daily briefing in Gmail Drafts; reviewed
  //     + sent during morning ritual. Button just logs that he sent it.
  //   - Texts: composed on iPhone; button logs the touch.
  //   - VMs: left on a call; button logs the outcome.
  // Ad-hoc compose escape hatches: email text link below action row
  // opens Gmail compose; phone number on card is read-and-dial.
  async function logTouchSimple(type: "VM" | "Email" | "Text") {
    if (!opp) return;
    setBusy(type);
    const preState = snapshotOpp(opp);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "touch", type }),
      });
      const phase = salesPhase(opp, today);
      const currentNextFu = opp.nextFollowUpDate;
      // Capped so VY/promise leads don't push 14 days out and vanish.
      const idealNext = cappedSmartSnoozeDate(opp, today, suggestedNextSalesTouchDate(opp, today, today));
      let shouldAdjust = false;
      if (!currentNextFu) shouldAdjust = true;
      else {
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
      // Mark this channel done; stay on card
      setCompletedActions((s) => new Set(s).add(type));
      setCompleted((c) => c + 1);
      setHistory((h) => [...h, {
        cursor,
        type,
        leadName: opp.name,
        leadId: opp.id,
        snapshot: preState,
      }]);
    } catch {
      // silent
    } finally {
      setBusy(null);
    }
  }

  async function saveNote() {
    if (!opp || !noteText.trim()) return;
    setBusy("Note");
    const preState = snapshotOpp(opp);
    try {
      // 1. Write the note text (always)
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: opp.id, action: "note", text: noteText }),
      });
      // 2. If a date was selected via the chip strip / custom input, also
      //    snooze NFU to that date. Same single-save flow Jared expects
      //    when "FU pushed to June 1" appears in a note.
      if (noteDate && /^\d{4}-\d{2}-\d{2}$/.test(noteDate)) {
        await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: opp.id, action: "snooze", date: noteDate }),
        });
      }
      // Note logged; close input, mark done, stay on card
      setCompletedActions((s) => new Set(s).add("Note"));
      setNoteOpen(false);
      setCompleted((c) => c + 1);
      const note = noteText;
      const dateForHistory = noteDate;
      setNoteText("");
      setNoteDate(null);
      setHistory((h) => [...h, {
        cursor,
        type: "Note",
        detail: dateForHistory ? `${note} (FU → ${dateForHistory})` : note,
        leadName: opp.name,
        leadId: opp.id,
        snapshot: preState,
      }]);
    } catch {
      // silent
    } finally {
      setBusy(null);
    }
  }

  function skip() {
    if (!opp) return;
    setSkipped((s) => s + 1);
    advance({ cursor, type: "Skip", leadName: opp.name });
  }

  function previous() {
    if (cursor === 0) return;
    setCursor((c) => c - 1);
    setNoteOpen(false);
    setNoteText("");
    setDispositionOpen(false);
    setCompletedActions(new Set());
    setLastDispositionLabel(null);
  }

  async function undo() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCursor(last.cursor);
    if (last.type === "Skip") {
      setSkipped((s) => Math.max(0, s - 1));
    } else {
      setCompleted((c) => Math.max(0, c - 1));
      // Fire the server-side revert for actions that wrote to the sheet.
      // Skip doesn't write anything, so no revert needed.
      if (last.leadId && last.snapshot) {
        try {
          await fetch("/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leadId: last.leadId,
              action: "revert",
              snapshot: last.snapshot,
            }),
          });
        } catch {
          // silent — UI already rewound, sheet state may be slightly off but Jared can re-fix
        }
      }
    }
    setNoteOpen(false);
    setNoteText("");
    setDispositionOpen(false);
    setCompletedActions(new Set());
    setLastDispositionLabel(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inEditable =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (inEditable) {
        if (e.key === "Escape") {
          setNoteOpen(false);
          setNoteText("");
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (!current) {
        if (e.key === "Escape") router.push("/");
        return;
      }
      // Disposition picker is open — handle disposition keys
      if (dispositionOpen) {
        if (e.key === "Escape") {
          setDispositionOpen(false);
          return;
        }
        if (e.key === "1") { e.preventDefault(); logDispositioned("Spoke"); return; }
        if (e.key === "2") { e.preventDefault(); logDispositioned("Left VM"); return; }
        if (e.key === "3") { e.preventDefault(); logDispositioned("No answer"); return; }
        if (e.key === "4") { e.preventDefault(); logDispositioned("Busy"); return; }
        if (e.key === "5") { e.preventDefault(); logDispositioned("Wrong number"); return; }
        return;
      }
      if (e.key === "Escape") {
        startTransition(() => router.push("/"));
      } else if (e.key === "1" && opp?.phone) {
        e.preventDefault();
        pressCall();
      } else if (e.key === "2" && opp?.phone) {
        e.preventDefault();
        logTouchSimple("VM");
      } else if (e.key === "3" && opp?.phone) {
        e.preventDefault();
        logTouchSimple("Text");
      } else if (e.key === "4" && opp?.email) {
        e.preventDefault();
        logTouchSimple("Email");
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNoteOpen(true);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        // Smart: advance via nextCard. If actions logged, it's "Next"; else "Skip".
        nextCard();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        previous();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, opp, history, dispositionOpen]);

  useEffect(() => {
    return () => {
      router.refresh();
    };
  }, [router]);

  if (total === 0) return <EmptyState scope={scope} />;
  if (!current) {
    return (
      <CompletedState
        total={total}
        completed={completed}
        skipped={skipped}
        elapsedMin={elapsedMin}
        avgSeconds={avgSeconds}
        scope={scope}
        history={history}
      />
    );
  }

  const progress = (cursor / total) * 100;

  return (
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-32">
      {/* Top metrics row — Linear-tier number treatment */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="text-cc-navy text-[42px] font-extrabold tabular-nums leading-none"
            style={{ letterSpacing: "-0.025em" }}
          >
            {cursor + 1}
          </span>
          <span className="text-text-muted text-sm font-medium">of</span>
          <span
            className="text-text-secondary text-2xl font-bold tabular-nums leading-none"
            style={{ letterSpacing: "-0.02em" }}
          >
            {total}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-text-muted font-bold">
          <Timer className="w-3.5 h-3.5" />
          <span className="tabular-nums">{elapsedMin}m</span>
          <span className="text-text-muted/40">·</span>
          <span className="tabular-nums">{completed} done</span>
          {avgSeconds > 0 && (
            <>
              <span className="text-text-muted/40">·</span>
              <span className="tabular-nums">{avgSeconds}s avg</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={previous}
            disabled={cursor === 0}
            title="Previous lead (←)"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-md border transition",
              cursor === 0
                ? "border-zinc-200 text-zinc-300 cursor-not-allowed"
                : "border-border bg-white text-text-secondary hover:bg-cc-navy hover:text-white hover:border-cc-navy shadow-sm"
            )}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            title="Undo last action (⌘Z)"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-md border transition",
              history.length === 0
                ? "border-zinc-200 text-zinc-300 cursor-not-allowed"
                : "border-border bg-white text-text-secondary hover:bg-cc-navy hover:text-white hover:border-cc-navy shadow-sm"
            )}
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-[3px] bg-zinc-200/80 rounded-full overflow-hidden mb-7">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-cc-accent to-amber-400 rounded-full"
        />
      </div>

      {/* The stage card — spring overshoot on advance (Superhuman pattern) */}
      <AnimatePresence mode="wait">
        <motion.div
          key={cursor}
          initial={{ opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.985 }}
          transition={{
            duration: 0.28,
            ease: [0.34, 1.32, 0.64, 1], // gentle overshoot
          }}
        >
          <FocusCard
            item={current}
            today={today}
            completedActions={completedActions}
            lastDispositionLabel={lastDispositionLabel}
            busy={busy}
            noteOpen={noteOpen}
            noteText={noteText}
            noteDate={noteDate}
            dispositionOpen={dispositionOpen}
            setNoteOpen={setNoteOpen}
            setNoteText={setNoteText}
            setNoteDate={setNoteDate}
            onPressCall={pressCall}
            onLogDisposition={logDispositioned}
            onCancelDisposition={() => setDispositionOpen(false)}
            onLogTouch={logTouchSimple}
            onSaveNote={saveNote}
            onSkip={skip}
            onNext={nextCard}
          />
        </motion.div>
      </AnimatePresence>

      {/* Next-up */}
      {nextUp && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="mt-6 pl-3 border-l-2 border-cc-accent/30 flex items-center gap-3 text-[12px]"
        >
          <span className="font-bold uppercase tracking-[0.15em] text-cc-navy/60">Next up</span>
          <span className="text-text-primary font-bold">{nextUp.opp.name}</span>
          <span className="text-text-muted/50">·</span>
          <span className="text-text-secondary">{nextUp.opp.stage}</span>
          {nextUp.opp.estValue > 0 && (
            <>
              <span className="text-text-muted/50">·</span>
              <span className="text-cc-navy font-semibold tabular-nums">{formatCurrency(nextUp.opp.estValue)}</span>
            </>
          )}
        </motion.div>
      )}

      {/* Session log footer — last 3 actions */}
      {history.length > 0 && (
        <SessionLogFooter history={history.slice(-3).reverse()} />
      )}
    </div>
  );
}

function FocusCard({
  item,
  today,
  completedActions,
  lastDispositionLabel,
  busy,
  noteOpen,
  noteText,
  noteDate,
  dispositionOpen,
  setNoteOpen,
  setNoteText,
  setNoteDate,
  onPressCall,
  onLogDisposition,
  onCancelDisposition,
  onLogTouch,
  onSaveNote,
  onSkip,
  onNext,
}: {
  item: FocusQueueItem;
  today: string;
  completedActions: Set<string>;
  lastDispositionLabel: string | null;
  busy: string | null;
  noteOpen: boolean;
  noteText: string;
  noteDate: string | null;
  dispositionOpen: boolean;
  setNoteOpen: (b: boolean) => void;
  setNoteText: (s: string) => void;
  setNoteDate: (s: string | null) => void;
  onPressCall: () => void;
  onLogDisposition: (d: CallDisposition) => void;
  onCancelDisposition: () => void;
  onLogTouch: (t: "VM" | "Email" | "Text") => void;
  onSaveNote: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const { opp, reason, reasonKind } = item;
  const reasonMeta = reasonChip(reasonKind);
  const heatGlow: Record<string, string> = {
    hot: "shadow-emerald-500/20",
    warm: "shadow-amber-500/20",
    cool: "shadow-sky-500/15",
    cold: "shadow-slate-700/30",
  };
  const heatRingGradient: Record<string, string> = {
    hot: "from-emerald-400/35",
    warm: "from-amber-400/30",
    cool: "from-sky-400/25",
    cold: "from-slate-400/20",
  };

  // Promise countdown
  const promiseCountdown = useMemo(() => {
    if (!opp.promise || !opp.promisedTime) return null;
    // promisedTime can be a date YYYY-MM-DD OR a time within today
    const promised = opp.promisedTime;
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(promised);
    if (isDate) {
      const target = new Date(promised + "T17:00:00").getTime(); // assume EOB if just date
      const diff = target - Date.now();
      return formatCountdown(diff, promised);
    }
    // Try parsing as time of day (e.g. "3pm", "15:00")
    const timeMatch = promised.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = timeMatch[3]?.toLowerCase();
      let h24 = hour;
      if (meridiem === "pm" && hour < 12) h24 += 12;
      if (meridiem === "am" && hour === 12) h24 = 0;
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h24, min, 0).getTime();
      const diff = target - Date.now();
      return formatCountdown(diff, promised);
    }
    return null;
  }, [opp.promise, opp.promisedTime, opp.id]);

  // Prefer AI-generated summary (refreshed by daily briefing, no per-token cost
  // in the deployed app — Jared's chat-side Max plan handles the summarization
  // before writing back to the Notes Summary column on the sheet).
  // Falls back to deterministic extraction from notes if no summary exists yet.
  const recentContext = opp.notesSummary?.trim() || extractRecentContext(opp.notes);
  const summaryIsBulleted = !!opp.notesSummary?.includes("• ") || !!opp.notesSummary?.includes("- ");
  const touchHistory = extractTouchHistory(opp.notes, today);
  // Touch count — max of available signals (callAttempts counts Call+VM,
  // notes-timestamp count covers Email/Text, both undercount fresh leads).
  const notesTouchCount = (opp.notes.match(/\[\d{4}-\d{2}-\d{2}\]:/g) || []).length;
  const touchCount = Math.max(opp.callAttempts ?? 0, notesTouchCount, touchHistory.length, opp.lastTouchDate ? 1 : 0);

  return (
    <div
      className={cn(
        "relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/5",
        heatGlow[opp.heat.tier]
      )}
    >
      {/* Navy gradient base — refined with subtler depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0E1F38] via-cc-navy-deep to-[#040E1F]" />

      {/* Heat-tier corner glow with subtle slow pulse */}
      <motion.div
        className={cn(
          "absolute -top-32 -right-32 w-72 h-72 rounded-full blur-3xl",
          heatRingGradient[opp.heat.tier],
          "bg-gradient-radial to-transparent"
        )}
        animate={{
          opacity: [0.55, 0.75, 0.55],
          scale: [1, 1.05, 1],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        aria-hidden
      />

      <div className="absolute -bottom-32 -left-32 w-72 h-72 rounded-full bg-cc-accent/10 blur-3xl" aria-hidden />

      {/* Noise texture */}
      <div
        className="absolute inset-0 opacity-[0.025] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
        aria-hidden
      />

      {/* Inner ring */}
      <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/[0.08] pointer-events-none" aria-hidden />

      {/* Content — V8 (4 zones, tightened to fit on one screen) */}
      <div className="relative p-6 sm:p-8 text-white">
        {/* Zone 1 — Meta header (reason chip + value) */}
        <div className="flex items-center justify-between mb-5 gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.14em]",
                reasonMeta.colorClass
              )}
            >
              {reasonMeta.icon}
              {reasonMeta.label}
            </div>
            {/* Promise countdown — inline next to reason chip when active */}
            {promiseCountdown && (
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.14em]",
                  promiseCountdown.isOverdue
                    ? "bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/40"
                    : promiseCountdown.isSoon
                      ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40"
                      : "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                )}
              >
                <Clock3 className="w-3 h-3" />
                <span className="tabular-nums">{promiseCountdown.text} {promiseCountdown.isOverdue ? "late" : "left"}</span>
              </div>
            )}
          </div>
          {opp.estValue > 0 && (
            <div
              className="text-[20px] font-extrabold tabular-nums text-cc-accent leading-none"
              style={{ letterSpacing: "-0.02em" }}
            >
              {formatCurrency(opp.estValue)}
            </div>
          )}
        </div>

        {/* Zone 2 — THE HERO (subject owns the canvas, calibrated to fit screen) */}
        <div className="mb-5">
          <div className="flex items-center gap-3 flex-wrap mb-1.5">
            {opp.promise && (
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-500/20 ring-1 ring-rose-400/30 shrink-0">
                <Flame className="w-4.5 h-4.5 text-rose-300" />
              </div>
            )}
            <h1
              className="text-4xl sm:text-5xl font-extrabold text-white leading-[0.95]"
              style={{ letterSpacing: "-0.028em" }}
            >
              {opp.name}
            </h1>
          </div>
          {/* Stage + phone — both scannable identity info */}
          <div className="flex items-center gap-2 flex-wrap text-[15px]">
            <span
              className="font-semibold text-white/70"
              style={{ letterSpacing: "-0.012em" }}
            >
              {opp.stage}
            </span>
            {opp.phone && (
              <>
                <span className="text-white/25">·</span>
                <a
                  href={`tel:${opp.phone.replace(/\s/g, "")}`}
                  className="font-mono font-semibold text-white/85 hover:text-cc-accent transition tabular-nums"
                  style={{ letterSpacing: "-0.01em" }}
                  title="Tap to dial via iPhone handoff, or just read and dial manually"
                >
                  {opp.phone}
                </a>
              </>
            )}
          </div>
        </div>

        {/* Zone 3 — THE CONTEXT (AI-summarized bullets or fallback paragraph) */}
        <div className="mb-5">
          {recentContext && (
            <div className="relative mb-2.5">
              <div className="absolute left-0 top-1 bottom-1 w-[2.5px] bg-gradient-to-b from-cc-accent to-cc-accent/30 rounded-full" />
              <div className="pl-4 text-[9px] uppercase tracking-[0.18em] font-bold text-cc-accent/80 mb-1.5">
                What to know — last touch + key context
              </div>
              {/* Scroll-capped container — long summaries (Stewart-style 4+
                  bullets with full sentences) scroll instead of breaking
                  the card layout. Cap = ~7 lines at the current line-height,
                  matching the "this is too much, I'd skim it" threshold.
                  Custom scrollbar tinted to brand so it reads as intentional. */}
              <div
                className="pl-4 max-h-[180px] overflow-y-auto pr-2 focus-context-scroll"
                style={{ scrollbarGutter: "stable" }}
              >
                {summaryIsBulleted ? (
                  <ul
                    className="space-y-1 text-[14px] text-white/85 leading-[1.5]"
                    style={{ letterSpacing: "-0.009em" }}
                  >
                    {recentContext
                      .split(/\n/)
                      .map((l) => l.trim())
                      .filter((l) => l)
                      .map((line, i) => (
                        <li key={i}>{line.replace(/^[•\-*]\s*/, "• ")}</li>
                      ))}
                  </ul>
                ) : (
                  <p
                    className="text-[14px] text-white/85 leading-[1.5]"
                    style={{ letterSpacing: "-0.009em" }}
                  >
                    {recentContext}
                  </p>
                )}
              </div>
            </div>
          )}
          {/* Touch history line — dots + total count + last touch detail */}
          <div className="pl-4 flex items-center gap-2 text-[11.5px] text-white/45 flex-wrap">
            {touchHistory.length > 0 && (
              <div className="flex items-center gap-1">
                {touchHistory.map((t, i) => (
                  <div
                    key={i}
                    className={cn("w-1.5 h-1.5 rounded-full ring-1 ring-white/15", t.color)}
                    title={`${t.label} · ${t.daysAgo === 0 ? "today" : `${t.daysAgo}d ago`}`}
                  />
                ))}
              </div>
            )}
            <span className="font-bold text-white/70 tabular-nums">
              {touchCount} {touchCount === 1 ? "touch" : "touches"}
            </span>
            {opp.lastTouchDate ? (
              <>
                <span className="text-white/25">·</span>
                <span>
                  last {opp.lastTouchType?.toLowerCase() || "touch"} {daysSinceLabel(opp.lastTouchDate, today)}
                </span>
              </>
            ) : (
              <>
                <span className="text-white/25">·</span>
                <span>never touched</span>
              </>
            )}
          </div>
        </div>

        {/* Note input + optional Next-FU date picker (per Jared 2026-05-12).
            Pick a date chip to also update NFU in the same save action.
            Leave "No date" selected to just save the note as-is. */}
        {noteOpen && (
          <div className="mb-5 p-3.5 bg-white/[0.06] border border-white/15 rounded-xl">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Quick note — ⏎ to save & advance · esc to cancel"
              rows={2}
              autoFocus
              className="w-full bg-transparent text-white placeholder:text-white/30 text-[15px] focus:outline-none resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveNote();
                }
                if (e.key === "Escape") {
                  setNoteOpen(false);
                  setNoteText("");
                  setNoteDate(null);
                }
              }}
            />
            <div className="mt-3 pt-3 border-t border-white/10">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/45 mr-1">
                  Set next FU:
                </span>
                <NoteDateChip
                  label="None"
                  active={noteDate === null}
                  onClick={() => setNoteDate(null)}
                />
                <NoteDateChip
                  label="Today"
                  active={noteDate === today}
                  onClick={() => setNoteDate(today)}
                />
                <NoteDateChip
                  label="+3d"
                  hint={addDaysISO(today, 3)}
                  active={noteDate === addDaysISO(today, 3)}
                  onClick={() => setNoteDate(addDaysISO(today, 3))}
                />
                <NoteDateChip
                  label="+7d"
                  hint={addDaysISO(today, 7)}
                  active={noteDate === addDaysISO(today, 7)}
                  onClick={() => setNoteDate(addDaysISO(today, 7))}
                />
                <NoteDateChip
                  label="+14d"
                  hint={addDaysISO(today, 14)}
                  active={noteDate === addDaysISO(today, 14)}
                  onClick={() => setNoteDate(addDaysISO(today, 14))}
                />
                <input
                  type="date"
                  value={noteDate && noteDate !== today
                    && noteDate !== addDaysISO(today, 3)
                    && noteDate !== addDaysISO(today, 7)
                    && noteDate !== addDaysISO(today, 14)
                    ? noteDate : ""}
                  onChange={(e) => setNoteDate(e.target.value || null)}
                  className="ml-1 bg-white/8 border border-white/15 rounded px-2 py-0.5 text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-cc-accent"
                  title="Pick a custom date for Next Follow-Up"
                />
              </div>
              {noteDate && (
                <div className="mt-2 text-[10.5px] text-cc-accent/90 font-semibold">
                  ✓ Saving will set Next FU → {noteDate}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Zone 4 — THE ACTION (full-width Call CTA + quiet secondary cluster) */}
        <AnimatePresence mode="wait">
          {dispositionOpen ? (
            <motion.div
              key="disposition"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-cc-accent">
                  Call outcome
                </div>
                <button
                  onClick={onCancelDisposition}
                  className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/40 hover:text-white/80 transition"
                >
                  Cancel · esc
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                <DispositionBtn label="Spoke" hint="1" accent onClick={() => onLogDisposition("Spoke")} />
                <DispositionBtn label="Left VM" hint="2" onClick={() => onLogDisposition("Left VM")} />
                <DispositionBtn label="No answer" hint="3" onClick={() => onLogDisposition("No answer")} />
                <DispositionBtn label="Busy" hint="4" onClick={() => onLogDisposition("Busy")} />
                <DispositionBtn label="Wrong number" hint="5" warn onClick={() => onLogDisposition("Wrong number")} />
              </div>
              <div className="mt-3 text-[11px] text-white/40 leading-snug">
                <span className="text-white/55">Spoke</span> & <span className="text-white/55">Left VM</span> advance cadence ·{" "}
                <span className="text-white/55">No answer</span> retries tomorrow ·{" "}
                <span className="text-white/55">Busy</span> retries later today ·{" "}
                <span className="text-white/55">Wrong number</span> flags for data fix
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-2.5"
            >
              {/* Single action row — log multiple touches per card, stay until Next */}
              <div className="flex items-stretch gap-1.5 flex-wrap">
                {opp.phone && (
                  <InlineCallBtn
                    busy={busy === "Call"}
                    done={completedActions.has("Call")}
                    doneLabel={lastDispositionLabel ? `Logged · ${lastDispositionLabel}` : "Logged"}
                    onClick={onPressCall}
                  />
                )}
                {opp.phone && (
                  <>
                    <SecondaryBtn
                      icon={<PhoneOff className="w-4 h-4" />}
                      label="VM"
                      hint="2"
                      busy={busy === "VM"}
                      done={completedActions.has("VM")}
                      onClick={() => onLogTouch("VM")}
                    />
                    <SecondaryBtn
                      icon={<MessageSquare className="w-4 h-4" />}
                      label="Text"
                      hint="3"
                      busy={busy === "Text"}
                      done={completedActions.has("Text")}
                      onClick={() => onLogTouch("Text")}
                    />
                  </>
                )}
                {opp.email && (
                  <SecondaryBtn
                    icon={<Mail className="w-4 h-4" />}
                    label="Email"
                    hint="4"
                    busy={busy === "Email"}
                    done={completedActions.has("Email")}
                    onClick={() => onLogTouch("Email")}
                  />
                )}
                <SecondaryBtn
                  icon={<StickyNote className="w-4 h-4" />}
                  label="Note"
                  hint="N"
                  busy={busy === "Note"}
                  done={completedActions.has("Note")}
                  onClick={() => setNoteOpen(true)}
                />
                {/* Next button — replaces Skip once any action has been logged.
                    Skip stays as the option if no actions logged (= "don't touch this one"). */}
                {completedActions.size > 0 ? (
                  <PrimaryNextBtn count={completedActions.size} onClick={onNext} />
                ) : (
                  <GhostBtn
                    icon={<SkipForward className="w-4 h-4" />}
                    label="Skip"
                    hint="→"
                    onClick={onSkip}
                  />
                )}
              </div>
              {/* Email + address as quiet text affordances below — accessible but not visually competing */}
              {(opp.email || opp.address) && (
                <div className="flex items-center gap-3 text-[11px] text-white/40 pt-1">
                  {opp.email && (
                    <a
                      href={`https://mail.google.com/mail/?authuser=jared.lim@colourcraftpainting.com&view=cm&fs=1&to=${encodeURIComponent(opp.email)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-cc-accent transition truncate max-w-[260px]"
                    >
                      {opp.email}
                    </a>
                  )}
                  {opp.email && opp.address && <span className="text-white/20">·</span>}
                  {opp.address && (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(opp.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-cc-accent transition truncate max-w-[220px]"
                    >
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{opp.address}</span>
                    </a>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DispositionBtn({
  label,
  hint,
  accent,
  warn,
  onClick,
}: {
  label: string;
  hint: string;
  accent?: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — press ${hint}`}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-bold text-sm transition-all duration-150 active:scale-[0.97] border tracking-tight",
        accent
          ? "bg-gradient-to-b from-emerald-400 to-emerald-500 text-emerald-950 border-emerald-300 shadow-lg shadow-emerald-500/30 hover:from-emerald-300 hover:to-emerald-400"
          : warn
            ? "bg-rose-500/15 text-rose-200 border-rose-400/30 hover:bg-rose-500/25 hover:border-rose-400/50"
            : "bg-white/[0.08] text-white/95 border-white/15 hover:bg-white/[0.14] hover:border-white/25"
      )}
    >
      <span>{label}</span>
      <kbd className={cn(
        "ml-0.5 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border",
        accent ? "border-emerald-700/40 text-emerald-900/80" : warn ? "border-rose-400/30 text-rose-300/80" : "border-white/20 text-white/50"
      )}>
        {hint}
      </kbd>
    </button>
  );
}

function InlineCallBtn({
  busy,
  done,
  doneLabel,
  onClick,
}: {
  busy: boolean;
  done: boolean;
  doneLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Call — dials and asks for outcome (press 1)"
      className={cn(
        "relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-extrabold text-sm transition-all duration-150 active:scale-[0.97] shrink-0 tracking-tight",
        done
          ? "bg-emerald-400 text-cc-navy shadow-lg shadow-emerald-500/30"
          : "bg-gradient-to-b from-cc-accent to-amber-500 text-cc-navy hover:from-cc-accent hover:to-amber-400 shadow-lg shadow-cc-accent/30 hover:shadow-xl hover:shadow-cc-accent/40 ring-1 ring-amber-400/50",
        busy && "opacity-70 cursor-wait"
      )}
    >
      {done ? <CheckCircle2 className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
      <span style={{ letterSpacing: "-0.02em" }}>{done ? doneLabel : "Call"}</span>
      {!done && (
        <kbd className="ml-0.5 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border border-cc-navy/40 text-cc-navy/70">
          1
        </kbd>
      )}
    </button>
  );
}

function SecondaryBtn({
  icon,
  label,
  hint,
  busy,
  done,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  busy?: boolean;
  done?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`${label} — press ${hint}`}
      className={cn(
        "flex-1 min-w-[64px] inline-flex items-center justify-center gap-1.5 px-2.5 py-3 rounded-xl font-bold text-sm transition-all duration-150 active:scale-[0.97] border tracking-tight",
        done
          ? "bg-emerald-400 text-cc-navy border-emerald-400 shadow-md"
          : "bg-white/[0.08] text-white/95 border-white/15 hover:bg-white/[0.14] hover:border-white/25 backdrop-blur-sm",
        busy && "opacity-60 cursor-wait"
      )}
    >
      {done ? <CheckCircle2 className="w-4 h-4" /> : icon}
      <span>{label}</span>
      <kbd className={cn(
        "ml-0.5 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border",
        done ? "border-cc-navy/30 text-cc-navy/70" : "border-white/20 text-white/50"
      )}>
        {hint}
      </kbd>
    </button>
  );
}

function PrimaryNextBtn({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Done — advance to next lead (press →)`}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm tracking-tight transition-all duration-150 active:scale-[0.97]",
        "bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-400/50"
      )}
    >
      <CheckCircle2 className="w-4 h-4" />
      <span>Next ({count})</span>
      <kbd className="ml-0.5 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border border-white/30 text-white/80">
        →
      </kbd>
    </button>
  );
}

function GhostBtn({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — press ${hint}`}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-[0.97] bg-transparent text-white/50 hover:text-white hover:bg-white/[0.05] border border-white/10 tracking-tight"
    >
      {icon}
      <span>{label}</span>
      <kbd className="ml-0.5 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border border-white/10 text-white/40">
        {hint}
      </kbd>
    </button>
  );
}

function SessionLogFooter({ history }: { history: ActionRecord[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="mt-8 pt-4 border-t border-zinc-200/60"
    >
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-text-muted mb-2">
        This session
      </div>
      <div className="space-y-1">
        {history.map((h, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            {h.type === "Skip" ? (
              <SkipForward className="w-3 h-3 text-text-muted" />
            ) : (
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            )}
            <span className="text-text-primary font-semibold">{h.leadName}</span>
            <span className="text-text-muted/70">·</span>
            <span className="text-text-secondary">
              {h.type === "Skip" ? "Skipped" : h.type === "Call" && h.disposition ? `Call · ${h.disposition}` : h.type}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function reasonChip(kind: FocusQueueItem["reasonKind"]): {
  icon: React.ReactNode;
  label: string;
  colorClass: string;
} {
  switch (kind) {
    case "promise-overdue":
      return { icon: <Flame className="w-3 h-3" />, label: "Promise overdue", colorClass: "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/30" };
    case "promise-today":
      return { icon: <Flame className="w-3 h-3" />, label: "Promise today", colorClass: "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/30" };
    case "verbal-yes-overdue":
      return { icon: <AlertTriangle className="w-3 h-3" />, label: "Deposit at risk", colorClass: "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30" };
    case "verbal-yes-deposit":
      return { icon: <Sparkles className="w-3 h-3" />, label: "Deposit touch", colorClass: "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30" };
    case "hot-overdue":
      return { icon: <AlertTriangle className="w-3 h-3" />, label: "Hot · overdue", colorClass: "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30" };
    case "warm-overdue":
      return { icon: <AlertTriangle className="w-3 h-3" />, label: "Warm · overdue", colorClass: "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30" };
    case "cool-overdue":
      return { icon: <AlertTriangle className="w-3 h-3" />, label: "Overdue", colorClass: "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30" };
    case "due-today":
      return { icon: <TrendingUp className="w-3 h-3" />, label: "Due today", colorClass: "bg-cc-accent/20 text-cc-accent ring-1 ring-cc-accent/30" };
    case "phase-stale":
      return { icon: <Layers className="w-3 h-3" />, label: "Phase-stale", colorClass: "bg-slate-500/20 text-slate-200 ring-1 ring-slate-400/30" };
  }
}

function daysSinceLabel(dateISO: string, today: string): string {
  const a = new Date(dateISO + "T12:00:00Z").getTime();
  const b = new Date(today + "T12:00:00Z").getTime();
  const days = Math.round((b - a) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function extractRecentContext(notes: string): string | null {
  if (!notes || !notes.trim()) return null;
  const match = notes.match(/^\[(\d{4}-\d{2}-\d{2})\]:\s*([\s\S]*?)(?=\n\n\[\d{4}-\d{2}-\d{2}\]:|$)/);
  let text: string;
  if (match) text = match[2].trim();
  else text = notes.split(/\n\n/)[0].trim();
  text = text.replace(/\[[^\]]+\]:?/g, "").replace(/\s+/g, " ").trim();
  // Strip auto-generated "Call → Spoke" lines if they're the only content
  text = text.replace(/^Call → (Spoke|Left VM|No answer|Busy|Wrong number).*?(?=\s|$)/, "").trim();
  if (!text) return null;
  if (text.length > 240) text = text.slice(0, 240).replace(/[\s,.;:-]+$/, "") + "…";
  return text;
}

/**
 * Touch history micro-timeline. Parses the notes column for the last 6
 * disposition / channel entries and returns them as colored dots.
 * Looks for "Call → X", "VM logged", "Email logged", "Text logged" patterns.
 * Falls back to the lastTouchType/Date single point if no rich history.
 */
function extractTouchHistory(notes: string, today: string): Array<{ color: string; label: string; daysAgo: number }> {
  if (!notes) return [];
  // Find all [YYYY-MM-DD]: blocks
  const matches = [...notes.matchAll(/\[(\d{4}-\d{2}-\d{2})\]:\s*([^\[]*?)(?=\n\n\[|$)/g)];
  const out: Array<{ color: string; label: string; daysAgo: number }> = [];
  for (const m of matches) {
    const date = m[1];
    const content = m[2].toLowerCase();
    let color = "";
    let label = "";
    if (/call → spoke|spoke|connected/.test(content)) {
      color = "bg-emerald-400";
      label = "Spoke";
    } else if (/call → left vm|voicemail|^vm|left vm/.test(content)) {
      color = "bg-sky-400";
      label = "Left VM";
    } else if (/call → no answer|no answer/.test(content)) {
      color = "bg-amber-400";
      label = "No answer";
    } else if (/call → busy|busy/.test(content)) {
      color = "bg-amber-300";
      label = "Busy";
    } else if (/call → wrong/.test(content)) {
      color = "bg-rose-400";
      label = "Wrong number";
    } else if (/^text|texted|sms/.test(content)) {
      color = "bg-violet-400";
      label = "Text";
    } else if (/^email|emailed/.test(content)) {
      color = "bg-indigo-400";
      label = "Email";
    } else if (/^call/.test(content)) {
      color = "bg-emerald-400";
      label = "Call";
    } else {
      continue; // Skip non-touch notes
    }
    const daysAgo = Math.round(
      (new Date(today + "T12:00:00Z").getTime() - new Date(date + "T12:00:00Z").getTime()) / 86400000
    );
    out.push({ color, label, daysAgo });
    if (out.length >= 6) break;
  }
  return out;
}

interface PromiseCountdown {
  text: string;
  isOverdue: boolean;
  isSoon: boolean;
}

function formatCountdown(diffMs: number, fallback: string): PromiseCountdown {
  const isOverdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  let text: string;
  if (days > 0) text = `${days}d ${hours}h`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;
  return {
    text,
    isOverdue,
    isSoon: !isOverdue && diffMs < 3600000 * 4,
  };
}

function EmptyState({ scope }: { scope: FocusScope }) {
  return (
    <div className="relative max-w-2xl mx-auto px-4 sm:px-6 py-20 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5 }}
        className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 mb-5 ring-2 ring-emerald-300/50 shadow-lg shadow-emerald-500/10"
      >
        <CheckCircle2 className="w-10 h-10" />
      </motion.div>
      <h1 className="text-4xl font-extrabold mb-3 tracking-tight text-text-primary">
        No calls to make {scope === "today" ? "today" : "in this scope"}
      </h1>
      <p className="text-text-secondary mb-7 max-w-md mx-auto text-base">
        Everything in healthy cadence — or already touched today. Strategic move: open the wider queue to work ahead of the curve.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ScopeButton href="/focus?scope=top25" label="Top 25 in pipeline" primary />
        <ScopeButton href="/focus?scope=verbal-yes" label="Verbal Yes only" />
        <ScopeButton href="/focus?scope=all-overdue" label="All overdue" />
        <ScopeButton href="/" label="Back to Pipeline" ghost />
      </div>
    </div>
  );
}

function CompletedState({
  total,
  completed,
  skipped,
  elapsedMin,
  avgSeconds,
  scope,
  history,
}: {
  total: number;
  completed: number;
  skipped: number;
  elapsedMin: number;
  avgSeconds: number;
  scope: FocusScope;
  history: ActionRecord[];
}) {
  const allDone = skipped === 0 && completed === total;
  const dispositionsSummary = history.filter((h) => h.disposition).reduce((acc, h) => {
    if (!h.disposition) return acc;
    acc[h.disposition] = (acc[h.disposition] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="relative max-w-2xl mx-auto px-4 sm:px-6 py-20 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", duration: 0.6, bounce: 0.4 }}
        className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 via-cc-accent/20 to-emerald-100 text-emerald-700 mb-6 ring-2 ring-emerald-300/40 shadow-xl shadow-emerald-500/20"
      >
        <CheckCircle2 className="w-12 h-12" />
      </motion.div>
      <motion.h1
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-4xl font-extrabold tracking-tight mb-2 text-text-primary"
      >
        {allDone ? "Queue cleared 🎯" : "Session done"}
      </motion.h1>

      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mt-7 mb-6 flex items-stretch justify-center gap-3 flex-wrap"
      >
        <StatChip value={completed} label={`action${completed === 1 ? "" : "s"} logged`} accent />
        {skipped > 0 && <StatChip value={skipped} label="skipped" />}
        <StatChip value={`${elapsedMin}m`} label="elapsed" />
        {avgSeconds > 0 && <StatChip value={`${avgSeconds}s`} label="avg / lead" />}
      </motion.div>

      {Object.keys(dispositionsSummary).length > 0 && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.32 }}
          className="mb-7 flex items-center justify-center gap-2 flex-wrap text-[12px]"
        >
          <span className="text-text-muted uppercase tracking-[0.15em] font-bold text-[10px]">Call outcomes</span>
          {Object.entries(dispositionsSummary).map(([d, n]) => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 border border-border text-text-primary font-semibold">
              <span className="tabular-nums">{n}</span>
              <span className="text-text-secondary">{d}</span>
            </span>
          ))}
        </motion.div>
      )}

      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {scope === "today" && <ScopeButton href="/focus?scope=top25" label="Keep going · Top 25" primary />}
        {scope !== "today" && <ScopeButton href="/focus" label="Back to Today's queue" primary />}
        <ScopeButton href="/" label="Back to Pipeline" ghost />
      </motion.div>
    </div>
  );
}

function StatChip({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-5 py-4 min-w-[120px] border shadow-sm",
        accent
          ? "bg-gradient-to-br from-cc-accent/15 to-cc-accent/5 border-cc-accent/30"
          : "bg-white border-border"
      )}
    >
      <div className={cn("text-3xl font-extrabold tabular-nums leading-none tracking-tight", accent ? "text-cc-navy" : "text-text-primary")}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold mt-1.5 text-text-muted">{label}</div>
    </div>
  );
}

function ScopeButton({ href, label, primary, ghost }: { href: string; label: string; primary?: boolean; ghost?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center px-5 py-2.5 text-sm font-bold rounded-lg transition tracking-tight",
        primary
          ? "bg-cc-navy text-white hover:bg-cc-navy-deep shadow-lg shadow-cc-navy/20"
          : ghost
            ? "bg-transparent text-text-secondary hover:text-text-primary border border-border"
            : "bg-white text-text-secondary hover:bg-zinc-50 border border-border shadow-sm"
      )}
    >
      {label}
    </Link>
  );
}

// ─── Inline Next-FU date picker helpers (added 2026-05-12) ────────────
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function NoteDateChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-[10.5px] font-bold rounded-md border transition uppercase tracking-wider",
        active
          ? "bg-cc-accent text-cc-navy border-cc-accent"
          : "bg-white/8 text-white/75 border-white/15 hover:bg-white/15 hover:text-white"
      )}
      title={hint ? `${label} → ${hint}` : label}
    >
      {label}
    </button>
  );
}
