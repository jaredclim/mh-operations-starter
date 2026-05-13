/**
 * Sales follow-up cadence — implements the CC Lead Tracker SOP
 * (Follow-Up Cadence.md). Mirror of `commsCadence.ts` for the
 * pre-production Communication module, but for the sales side.
 *
 * Core principle: cadence is anchored on TTD (Target Touch Date —
 * what the client said for when to reach out) AND on phase progression
 * from proposal date. The four-phase model:
 *
 *   Phase 1 — Active Decision (Days 0 to +14)
 *       Cadence: Day 0, +5, +10, +14 — tight follow-up while decision warm.
 *   Phase 2 — Value Nurture (Days +21 to +45)
 *       Cadence: +21, +35, +45 — slower drip with value-add content.
 *   Phase 3 — Closing the Loop (Days +55, +85)
 *       Cadence: +55, +85 — rare touch, breakup-style nudges.
 *   Phase 4 — Seasonal (90+ days, no response)
 *       Cadence: seasonal layer only — dormant unless re-engaged.
 *
 * Verbal Yes sub-cadence (deposit collection):
 *   Day 0 - 2 - 4 - 7 - 11 - 14 from verbal yes acceptance.
 *
 * Source SOP: 01-Colour-Craft-Franchisee/Sales/Follow-Up Cadence.md
 */

import type { ScoredOpportunity } from "./types";

export type SalesPhase =
  | "verbal-yes"
  | "phase-1"
  | "phase-2"
  | "phase-3"
  | "phase-4"
  | "on-hold"
  | "long-term"
  | "unknown";

export interface SalesCadencePhase {
  id: SalesPhase;
  label: string;
  description: string;          // What this phase is for
  guidance: string;             // SOP guidance for this phase
  suggestedNextTouchDays: number;  // Default next-touch interval from today
  minGapFromLast: number;       // Min reasonable gap between consecutive touches
  maxGapDays: number;           // Max acceptable gap before flagging "stale"
}

/**
 * Determines what cadence phase a lead is currently in, anchored on
 * stage + days-since-proposal + verbal-yes status.
 */
export function salesPhase(opp: ScoredOpportunity, todayISO: string): SalesCadencePhase {
  // Verbal Yes wins everything — deposit collection sub-cadence
  if (opp.stage === "Verbal Yes") {
    return {
      id: "verbal-yes",
      label: "Verbal Yes",
      description: "Client verbally committed. Deposit collection sub-cadence active.",
      guidance: "Deposit collection: Day 0/+2/+4/+7/+11/+14 touches until deposit lands. Single biggest revenue leak if missed.",
      suggestedNextTouchDays: 2,
      minGapFromLast: 1,
      maxGapDays: 4,
    };
  }
  if (opp.stage === "On Hold") {
    return {
      id: "on-hold",
      label: "On Hold",
      description: "Client paused for a defined reason. Cadence light until trigger.",
      guidance: "Respect their stated timeline. Only re-engage on the agreed date or if context changes.",
      suggestedNextTouchDays: 14,
      minGapFromLast: 7,
      maxGapDays: 30,
    };
  }
  if (opp.stage === "Long-Term") {
    return {
      id: "long-term",
      label: "Long-Term",
      description: "Client booked weeks/months out. Touch is occasional warmth.",
      guidance: "Light warm-touch every 3-4 weeks. Don't over-call clients with confirmed long-out timelines.",
      suggestedNextTouchDays: 21,
      minGapFromLast: 10,
      maxGapDays: 35,
    };
  }
  if (opp.stage === "Proposal Sent") {
    // Calculate days since proposal to determine which Phase 1-4 they're in
    const days = opp.proposalDate ? daysBetween(opp.proposalDate, todayISO) : null;
    if (days == null) {
      return {
        id: "unknown",
        label: "Unknown phase",
        description: "No proposal date logged. Cadence cannot be computed precisely.",
        guidance: "Log a proposal date to enable phase-based cadence.",
        suggestedNextTouchDays: 5,
        minGapFromLast: 3,
        maxGapDays: 14,
      };
    }
    if (days <= 14) {
      return {
        id: "phase-1",
        label: "Phase 1 · Active",
        description: `Active decision window — Day +${days} from proposal.`,
        guidance: "Touch cadence: Day 0 / +5 / +10 / +14. Decision is warm — be present without pressuring.",
        suggestedNextTouchDays: Math.max(5 - (days % 5), 2),
        minGapFromLast: 3,
        maxGapDays: 7,
      };
    }
    if (days <= 45) {
      return {
        id: "phase-2",
        label: "Phase 2 · Nurture",
        description: `Value nurture — Day +${days} from proposal.`,
        guidance: "Touch cadence: +21 / +35 / +45. Drip value content (home preview, paint info, seasonal angle). No hard close.",
        suggestedNextTouchDays: 14,
        minGapFromLast: 7,
        maxGapDays: 21,
      };
    }
    if (days <= 85) {
      return {
        id: "phase-3",
        label: "Phase 3 · Re-engage",
        description: `Closing the loop — Day +${days} from proposal.`,
        guidance: "Touch cadence: +55 / +85. Breakup-style nudge ('still considering?'). One last value angle, then move to Phase 4.",
        suggestedNextTouchDays: 21,
        minGapFromLast: 14,
        maxGapDays: 35,
      };
    }
    return {
      id: "phase-4",
      label: "Phase 4 · Seasonal",
      description: `Dormant — Day +${days} from proposal. Cold unless re-engaged.`,
      guidance: "Seasonal touch only (start of season, end of season). Or hibernate until client re-engages.",
      suggestedNextTouchDays: 60,
      minGapFromLast: 30,
      maxGapDays: 120,
    };
  }
  return {
    id: "unknown",
    label: "Unknown",
    description: "Stage not recognized for cadence.",
    guidance: "Review stage assignment.",
    suggestedNextTouchDays: 7,
    minGapFromLast: 3,
    maxGapDays: 14,
  };
}

export type SalesCommsLevel = "green" | "amber" | "rose" | "none";

export interface SalesCommsState {
  level: SalesCommsLevel;
  label: string;        // Short chip label
  detail: string;       // Tooltip / description
  phase: SalesCadencePhase;
  suggestedNextTouchDays: number;
}

/**
 * Comms state for an opportunity. Drives the card chip color and the
 * drawer Communication section chip. Mirrors `commsState` in
 * commsCadence.ts.
 */
export function salesCommsState(opp: ScoredOpportunity, todayISO: string): SalesCommsState {
  const phase = salesPhase(opp, todayISO);
  const lastDays = opp.lastTouchDate ? daysBetween(opp.lastTouchDate, todayISO) : null;
  const nextDays = opp.nextFollowUpDate ? daysBetween(todayISO, opp.nextFollowUpDate) : null;

  // Promise active and overdue → always rose
  if (opp.promise && opp.promisedTime) {
    const promiseDays = daysBetween(todayISO, opp.promisedTime);
    if (promiseDays < 0) {
      return {
        level: "rose",
        label: `Promise ${Math.abs(promiseDays)}d overdue`,
        detail: `Client was promised contact by ${opp.promisedTime}. ${Math.abs(promiseDays)} days past.`,
        phase,
        suggestedNextTouchDays: 0,
      };
    }
    if (promiseDays === 0) {
      return {
        level: "rose",
        label: "Promise due today",
        detail: `Promised the client today (${opp.promisedTime}).`,
        phase,
        suggestedNextTouchDays: 0,
      };
    }
    if (promiseDays <= 2) {
      return {
        level: "amber",
        label: `Promise in ${promiseDays}d`,
        detail: `Promised the client by ${opp.promisedTime}.`,
        phase,
        suggestedNextTouchDays: promiseDays,
      };
    }
  }

  if (nextDays != null) {
    if (nextDays < 0) {
      return {
        level: "rose",
        label: `${Math.abs(nextDays)}d overdue`,
        detail: `Next follow-up was scheduled for ${opp.nextFollowUpDate}.`,
        phase,
        suggestedNextTouchDays: phase.suggestedNextTouchDays,
      };
    }
    if (nextDays === 0) {
      return {
        level: "rose",
        label: "Due today",
        detail: "Follow-up is due today.",
        phase,
        suggestedNextTouchDays: phase.suggestedNextTouchDays,
      };
    }
    if (nextDays <= 2) {
      return {
        level: "amber",
        label: `Due in ${nextDays}d`,
        detail: `Follow-up scheduled for ${opp.nextFollowUpDate}.`,
        phase,
        suggestedNextTouchDays: phase.suggestedNextTouchDays,
      };
    }
    return {
      level: "green",
      label: `Next in ${nextDays}d`,
      detail: `Follow-up scheduled for ${opp.nextFollowUpDate}.`,
      phase,
      suggestedNextTouchDays: phase.suggestedNextTouchDays,
    };
  }

  if (lastDays == null) {
    return {
      level: "amber",
      label: "No touch logged",
      detail: "No touch history. Log first touch to enable cadence tracking.",
      phase,
      suggestedNextTouchDays: phase.suggestedNextTouchDays,
    };
  }

  if (lastDays > phase.maxGapDays) {
    return {
      level: "rose",
      label: `${lastDays}d since`,
      detail: `Last touched ${lastDays}d ago — past the ${phase.maxGapDays}-day max for "${phase.label}".`,
      phase,
      suggestedNextTouchDays: 0,
    };
  }
  if (lastDays > phase.maxGapDays * 0.7) {
    return {
      level: "amber",
      label: `${lastDays}d since`,
      detail: `Last touched ${lastDays}d ago, approaching the ${phase.maxGapDays}-day window for "${phase.label}".`,
      phase,
      suggestedNextTouchDays: phase.suggestedNextTouchDays,
    };
  }
  return {
    level: "green",
    label: lastDays === 0 ? "Fresh (today)" : `Fresh (${lastDays}d)`,
    detail: `Last touched ${lastDays}d ago. Within ${phase.maxGapDays}-day window for "${phase.label}".`,
    phase,
    suggestedNextTouchDays: phase.suggestedNextTouchDays,
  };
}

/**
 * Smart next-touch date suggestion when logging a touch — respects the
 * bucket's natural interval AND the minimum gap from the just-logged
 * touch date. Mirrors `suggestedNextTouchDate` in commsCadence.ts.
 */
export function suggestedNextSalesTouchDate(
  opp: ScoredOpportunity,
  lastDateISO: string,
  todayISO: string
): string {
  const phase = salesPhase(opp, todayISO);
  const suggestedDays = phase.suggestedNextTouchDays;
  const today = new Date(todayISO + "T12:00:00Z");
  const fromToday = new Date(today);
  fromToday.setUTCDate(fromToday.getUTCDate() + suggestedDays);
  const last = new Date(lastDateISO + "T12:00:00Z");
  const fromLast = new Date(last);
  fromLast.setUTCDate(fromLast.getUTCDate() + phase.minGapFromLast);
  const candidate = fromToday.getTime() > fromLast.getTime() ? fromToday : fromLast;
  const chosen = candidate.getTime() < today.getTime() ? today : candidate;
  return chosen.toISOString().slice(0, 10);
}

/**
 * Channel-aware cadence step. Given an opp's current touch count, returns
 * the next scheduled touch's date AND channel. This is the V2 cadence
 * model (Jared 2026-05-12):
 *
 *   Touch # | Interval since prev | Channel
 *   ────────┼─────────────────────┼─────────────────────
 *   1       | (Day 0 / TTD)       | Call
 *   2       | +2 days             | Call
 *   3       | +2 days             | Call
 *   4       | +3 days (Day +7)    | Call + Email
 *   5       | +3 days (Day +10)   | Call + Email
 *   6       | +4 days (Day +14)   | Email
 *   7       | +7 days (Day +21)   | Email
 *   8       | +14 days (Day +35)  | Call + Email
 *   9       | +20 days (Day +55)  | Email (breakup #1)
 *   10      | +30 days (Day +85)  | Email (breakup #2)
 *   11+     | Seasonal (~+90)     | Email
 *
 * Overridden by:
 *   - Verbal Yes stage → VY sub-cadence (0/+2/+5/+10/+14, Call-heavy)
 *   - Promise=YES with future promiseTime → Call default
 *   - [OVERRIDE: force-call] tag in notes → Call
 *   - [OVERRIDE: force-email] tag in notes → Email
 *   - [OVERRIDE: passive-email] tag in notes → Email
 *   - 3+ VMs in a row (callAttempts) AND we're in Phase 1 → escalate to Email
 */
export type SalesChannel = "Call" | "Email" | "Call + Email";

const CADENCE_TABLE: Array<{ interval: number; channel: SalesChannel }> = [
  { interval: 0,  channel: "Call" },         // Touch 1 (Day 0)
  { interval: 2,  channel: "Call" },         // Touch 2 (Day 2)
  { interval: 2,  channel: "Call" },         // Touch 3 (Day 4)
  { interval: 3,  channel: "Call + Email" }, // Touch 4 (Day 7)
  { interval: 3,  channel: "Call + Email" }, // Touch 5 (Day 10)
  { interval: 4,  channel: "Email" },        // Touch 6 (Day 14)
  { interval: 7,  channel: "Email" },        // Touch 7 (Day 21)
  { interval: 14, channel: "Call + Email" }, // Touch 8 (Day 35)
  { interval: 20, channel: "Email" },        // Touch 9 (Day 55, breakup)
  { interval: 30, channel: "Email" },        // Touch 10 (Day 85, final breakup)
];

const VY_CADENCE: Array<{ interval: number; channel: SalesChannel }> = [
  { interval: 0,  channel: "Call" },         // VY Day 0 — confirm + send deposit link
  { interval: 2,  channel: "Call" },         // VY Day 2
  { interval: 3,  channel: "Call + Email" }, // VY Day 5
  { interval: 5,  channel: "Call + Email" }, // VY Day 10
  { interval: 4,  channel: "Email" },        // VY Day 14 — demote signal
];

export interface ScheduledTouch {
  date: string;          // ISO YYYY-MM-DD
  channel: SalesChannel;
  cadenceStep: number;   // 1-based index in cadence table
  reason: string;        // human-readable
}

/**
 * Given a lead's current touch count + anchor date, compute the next
 * scheduled touch (date + channel). This is the canonical cadence
 * function — use everywhere we need to know "when + how" to follow up.
 */
export function nextScheduledTouch(
  opp: ScoredOpportunity,
  touchCount: number,
  todayISO: string
): ScheduledTouch {
  // Detect override tags in notes
  const notes = opp.notes || "";
  const forceCall = /\[OVERRIDE:\s*force-call/i.test(notes);
  const forceEmail = /\[OVERRIDE:\s*force-email|\[OVERRIDE:\s*passive-email|\[OVERRIDE:\s*low-priority/i.test(notes);

  // Verbal Yes uses its own sub-cadence
  if (opp.stage === "Verbal Yes") {
    const stepIdx = Math.min(touchCount, VY_CADENCE.length - 1);
    const step = VY_CADENCE[stepIdx];
    const anchorDate = opp.lastTouchDate || todayISO;
    const nextDate = addDays(anchorDate, step.interval);
    let channel = step.channel;
    if (forceCall) channel = "Call";
    if (forceEmail) channel = "Email";
    return {
      date: nextDate < todayISO ? todayISO : nextDate,
      channel,
      cadenceStep: stepIdx + 1,
      reason: `Verbal Yes deposit cadence Day ${cumulativeDays(VY_CADENCE, stepIdx)}`,
    };
  }

  // Promise=YES with future date → Call (verbal commitments deserve voice)
  if (opp.promise && opp.promisedTime && /^\d{4}-\d{2}-\d{2}/.test(opp.promisedTime)) {
    const promiseDate = opp.promisedTime.slice(0, 10);
    if (promiseDate >= todayISO) {
      return {
        date: promiseDate,
        channel: forceEmail ? "Email" : "Call",
        cadenceStep: touchCount + 1,
        reason: `Promise commitment for ${promiseDate}`,
      };
    }
  }

  // Standard cadence (Proposal Sent, On Hold, Long-Term, Unknown)
  const stepIdx = Math.min(touchCount, CADENCE_TABLE.length - 1);
  const step = CADENCE_TABLE[stepIdx];
  const anchorDate = opp.lastTouchDate || opp.proposalDate || todayISO;
  let nextDate = addDays(anchorDate, step.interval);
  if (nextDate < todayISO) nextDate = todayISO;

  let channel = step.channel;
  // 3+ unanswered VMs in Phase 1 → switch to Email (per SOP)
  if (opp.callAttempts != null && opp.callAttempts >= 3 && stepIdx < 5) {
    channel = "Email";
  }
  if (forceCall) channel = "Call";
  if (forceEmail) channel = "Email";

  return {
    date: nextDate,
    channel,
    cadenceStep: stepIdx + 1,
    reason: `Step ${stepIdx + 1} of standard cadence (${step.channel}, +${step.interval}d from last touch)`,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cumulativeDays(table: Array<{ interval: number }>, untilIdx: number): number {
  let sum = 0;
  for (let i = 0; i <= untilIdx; i++) sum += table[i].interval;
  return sum;
}

/**
 * Quick-log smart-snooze cap. The naive `suggestedNextSalesTouchDate` uses
 * the phase's `suggestedNextTouchDays` which can be very long for
 * Proposal-Sent-Phase-2 (14 days). For HOT leads, Verbal Yes, or any
 * Promise=YES lead, that's too aggressive — clicking VM should never
 * cause the lead to vanish from "Today/Tomorrow/Overdue" buckets.
 *
 * Cap rules:
 *  - Stage = Verbal Yes → max 3 calendar days out
 *  - Promise = YES → max 5 calendar days out
 *  - Otherwise → return ideal as computed
 *
 * Added 2026-05-11 after Stewart Whitfield disappeared from the dashboard
 * (VM click pushed FU 14 days out based on stale Proposal Sent stage).
 */
export function cappedSmartSnoozeDate(
  opp: ScoredOpportunity,
  todayISO: string,
  idealISO: string
): string {
  const today = new Date(todayISO + "T12:00:00Z");
  const ideal = new Date(idealISO + "T12:00:00Z");
  let capDays: number | null = null;
  if (opp.stage === "Verbal Yes") capDays = 3;
  else if (opp.promise) capDays = 3;
  if (capDays == null) return idealISO;
  const cap = new Date(today);
  cap.setUTCDate(cap.getUTCDate() + capDays);
  const chosen = ideal.getTime() > cap.getTime() ? cap : ideal;
  return chosen.toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
