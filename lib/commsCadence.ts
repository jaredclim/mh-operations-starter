/**
 * Client communication cadence — implements CC SOP
 * "Communication & Scheduling Logistics with Upcoming Projects."
 *
 * Core rule: cadence is anchored to TIME-TO-START, not time-since-last-touch.
 * As the job approaches, the recommended communication interval narrows
 * because we can commit to tighter date windows. The buckets below match
 * the SOP verbatim:
 *
 *   ~1 month out  → narrow to a 2-week window         (next touch ~14d out)
 *   ~2 weeks out  → narrow to a 1-week window         (next touch ~7d out)
 *   ~1 week out   → narrow to a 3-4 day window        (next touch ~3d out)
 *   Week of       → narrow to a 1-2 day window        (next touch ~1d out)
 *   1-3 days out  → wash + pre-job walk scheduling    (next touch day-of)
 *
 * "We can't guarantee a start date a month out, but we can 2-3 days out."
 *
 * SOP also states: clients should never have to call us for an update.
 * Every touch ends with the next promised date. The dashboard's job is to
 * tell Jared (or his PM) when a job is overdue per the bucket the job is
 * currently in, not on a flat "every 14 days" timer.
 */

import type { ProductionJob } from "./types";

export interface CadenceBucket {
  id: "far" | "month" | "two-weeks" | "one-week" | "week-of" | "days-before" | "started" | "complete";
  label: string;            // Short label, fits in a chip
  windowGuidance: string;   // What window to communicate at this stage
  nextTouchInDays: number | null;  // Suggested days from now for next touch (null = N/A)
  maxGapDays: number;       // Max acceptable days between touches at this stage
  minGapFromLast: number;   // Minimum days between consecutive touches at this stage
                             // (prevents back-to-back calls when backdating)
}

/**
 * Determines the cadence bucket for a job based on days-to-start.
 * Negative daysToStart = job has started (in production or complete).
 */
export function cadenceBucket(job: ProductionJob, todayISO: string): CadenceBucket {
  if (job.status === "Complete") {
    return {
      id: "complete",
      label: "Complete",
      windowGuidance: "Job complete — communication on review / invoice cadence",
      nextTouchInDays: null,
      maxGapDays: 999,
      minGapFromLast: 999,
    };
  }
  if (!job.startDate) {
    // Unscheduled — treat as "far out" for cadence purposes (Jared can still proactively touch)
    return {
      id: "far",
      label: "Unscheduled",
      windowGuidance: "No start date yet — touch when scheduling firms up",
      nextTouchInDays: 30,
      maxGapDays: 30,
      minGapFromLast: 7,
    };
  }
  const d = daysBetween(todayISO, job.startDate);
  if (d < 0) {
    return {
      id: "started",
      label: "In production",
      windowGuidance: "Job in progress — daily/as-needed updates",
      nextTouchInDays: 1,
      maxGapDays: 3,
      minGapFromLast: 1,
    };
  }
  // Bucket transitions land at d = 3, 7, 14, 30, 60. `nextTouchInDays` =
  // days from today until the next narrower bucket transition (floor 1
  // so we never suggest "today" except in the imminent days-before case
  // where same-day calls are normal for wash scheduling).
  if (d <= 3) {
    return {
      id: "days-before",
      label: `${d}d before start`,
      windowGuidance: "Wash + pre-job walk-around scheduling. Confirm water access, windows closed, day-of expectations.",
      nextTouchInDays: Math.max(d - 1, 0),  // day-before or day-of
      maxGapDays: 2,
      minGapFromLast: 1,  // same-day calls OK occasionally (e.g. wash + walk)
    };
  }
  if (d <= 7) {
    return {
      id: "week-of",
      label: "Week of",
      windowGuidance: "Give a 1-2 day start window. Schedule pre-job walk-around. Confirm wash plan.",
      nextTouchInDays: Math.max(d - 3, 1),
      maxGapDays: 3,
      minGapFromLast: 2,
    };
  }
  if (d <= 14) {
    return {
      id: "one-week",
      label: "1 week out",
      windowGuidance: "Give a 3-4 day start window. Start narrowing the start date with the client.",
      nextTouchInDays: Math.max(d - 7, 1),
      maxGapDays: 7,
      minGapFromLast: 3,  // SOP: "3-4 day window" → don't call back-to-back
    };
  }
  if (d <= 30) {
    return {
      id: "two-weeks",
      label: "2 weeks out",
      windowGuidance: "Give a 1-week start window. Watch weather forecast. Plan walk-around availability.",
      nextTouchInDays: Math.max(d - 14, 1),
      maxGapDays: 10,
      minGapFromLast: 5,
    };
  }
  if (d <= 60) {
    return {
      id: "month",
      label: "~1 month out",
      windowGuidance: "Give a 2-week start window. First proactive narrowing of the schedule.",
      nextTouchInDays: Math.max(d - 30, 1),
      maxGapDays: 21,
      minGapFromLast: 7,
    };
  }
  return {
    id: "far",
    label: "Far out",
    windowGuidance: "Booked for the month. Keep the client warm but don't over-call — they'll prefer a check-in nearer to start.",
    nextTouchInDays: Math.max(d - 60, 1),
    maxGapDays: 35,
    minGapFromLast: 14,  // far out: weeks between touches is fine
  };
}

/**
 * Computes the right next-touch date given a (possibly-backdated) last
 * touch date. Respects BOTH the bucket's natural next-transition AND
 * the minimum gap from the last touch — so if you backdate yesterday
 * we don't suggest calling them today.
 *
 * Returns ISO date string. Always >= today.
 */
export function suggestedNextTouchDate(
  job: ProductionJob,
  lastDateISO: string,
  todayISO: string
): string {
  const bucket = cadenceBucket(job, todayISO);
  const suggestedDays = bucket.nextTouchInDays ?? 7;
  // Today + bucket suggestion (natural narrowing transition)
  const today = new Date(todayISO + "T12:00:00Z");
  const fromToday = new Date(today);
  fromToday.setUTCDate(fromToday.getUTCDate() + suggestedDays);
  // Last + min gap (don't schedule back-to-back relative to last touch)
  const last = new Date(lastDateISO + "T12:00:00Z");
  const fromLast = new Date(last);
  fromLast.setUTCDate(fromLast.getUTCDate() + bucket.minGapFromLast);
  // Pick LATER of the two
  const candidate = fromToday.getTime() > fromLast.getTime() ? fromToday : fromLast;
  // Clamp to >= today (no past dates)
  const chosen = candidate.getTime() < today.getTime() ? today : candidate;
  return chosen.toISOString().slice(0, 10);
}

export type CommsLevel = "green" | "amber" | "rose" | "none";

export interface CommsState {
  level: CommsLevel;
  label: string;         // For the chip ("Fresh", "Due in 2d", "5d overdue", "Never touched")
  detail: string;        // Tooltip / description
  bucket: CadenceBucket;
  suggestedNextTouchDays: number | null;  // What "Just talked to them" should set, given current bucket
}

/**
 * Comms state for a job — combines the bucket + last/next touch dates
 * into a single level + label. The level drives the dot color on the
 * card and the chip color in the drawer.
 *
 * Logic:
 *  - Complete jobs → none (no flag needed; communication is on review cadence)
 *  - Scheduled next-touch overdue → rose
 *  - Scheduled next-touch within ~2d → amber (approaching)
 *  - Scheduled next-touch further out → green
 *  - No scheduled next-touch:
 *    - Last touch fresher than bucket.maxGapDays → green
 *    - Last touch older than bucket.maxGapDays → rose (overdue per bucket)
 *    - Never touched + within 30d of start → rose (proactive comms violation)
 *    - Never touched + 30d+ out → amber (should reach out, not yet critical)
 */
export function commsState(job: ProductionJob, todayISO: string): CommsState {
  const bucket = cadenceBucket(job, todayISO);

  if (bucket.id === "complete") {
    return {
      level: "none",
      label: "Complete",
      detail: "Job is complete — comms cadence does not apply.",
      bucket,
      suggestedNextTouchDays: null,
    };
  }

  const lastDays = job.lastClientTouch ? daysBetween(job.lastClientTouch, todayISO) : null;
  const nextDays = job.nextClientTouch ? daysBetween(todayISO, job.nextClientTouch) : null;

  // Scheduled next-touch wins — if Jared promised a specific date, use that.
  if (nextDays != null) {
    if (nextDays < 0) {
      return {
        level: "rose",
        label: `${Math.abs(nextDays)}d overdue`,
        detail: `Next touch was scheduled for ${job.nextClientTouch}. ${Math.abs(nextDays)} day${Math.abs(nextDays) === 1 ? "" : "s"} overdue.`,
        bucket,
        suggestedNextTouchDays: bucket.nextTouchInDays,
      };
    }
    if (nextDays <= 2) {
      return {
        level: "amber",
        label: nextDays === 0 ? "Due today" : `Due in ${nextDays}d`,
        detail: `Next touch scheduled for ${job.nextClientTouch}.`,
        bucket,
        suggestedNextTouchDays: bucket.nextTouchInDays,
      };
    }
    return {
      level: "green",
      label: `Next in ${nextDays}d`,
      detail: `Next touch scheduled for ${job.nextClientTouch}. ${bucket.label} · ${bucket.windowGuidance}`,
      bucket,
      suggestedNextTouchDays: bucket.nextTouchInDays,
    };
  }

  // No scheduled next-touch — fall back to last-touch age vs bucket maxGap.
  //
  // IMPORTANT: empty lastClientTouch does NOT mean "never communicated."
  // Per Jared's rule (2026-05-10): every booked job had a touch at booking
  // — that's how CC operates. The dashboard just doesn't have it logged.
  // So we never auto-rose a job purely for absent lastClientTouch unless
  // we're inside the imminent buckets (1 week out or closer) where
  // active comms is non-negotiable per SOP.
  if (lastDays == null) {
    if (bucket.id === "days-before" || bucket.id === "week-of" || bucket.id === "one-week") {
      return {
        level: "rose",
        label: "Log a touch",
        detail: `Start is imminent (${bucket.label}) and no touch is logged yet. ${bucket.windowGuidance}`,
        bucket,
        suggestedNextTouchDays: 0,
      };
    }
    return {
      level: "amber",
      label: "Log first touch",
      detail: `No touch logged yet (booking touch is assumed). Log next time you reach out to start tracking the cadence. ${bucket.windowGuidance}`,
      bucket,
      suggestedNextTouchDays: bucket.nextTouchInDays,
    };
  }

  if (lastDays > bucket.maxGapDays) {
    return {
      level: "rose",
      label: `${lastDays}d since`,
      detail: `Last touched ${lastDays}d ago — past the ${bucket.maxGapDays}-day window for "${bucket.label}". ${bucket.windowGuidance}`,
      bucket,
      suggestedNextTouchDays: 0,
    };
  }
  // Approaching the cadence limit
  if (lastDays > bucket.maxGapDays * 0.7) {
    return {
      level: "amber",
      label: `${lastDays}d since`,
      detail: `Last touched ${lastDays}d ago, approaching the ${bucket.maxGapDays}-day window for "${bucket.label}".`,
      bucket,
      suggestedNextTouchDays: bucket.nextTouchInDays,
    };
  }
  return {
    level: "green",
    label: lastDays === 0 ? "Fresh (today)" : `Fresh (${lastDays}d)`,
    detail: `Last touched ${lastDays}d ago. Within the ${bucket.maxGapDays}-day window for "${bucket.label}". ${bucket.windowGuidance}`,
    bucket,
    suggestedNextTouchDays: bucket.nextTouchInDays,
  };
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
