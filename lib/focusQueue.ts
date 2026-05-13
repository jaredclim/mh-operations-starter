/**
 * Focus Mode queue builder. Returns a prioritized list of opportunities
 * Jared should be contacting TODAY, ranked so that if he only gets
 * through the first N, those N are objectively the highest-impact.
 *
 * Inclusion filter:
 *   - Promises overdue or due today
 *   - Next-FU overdue or = today
 *   - Verbal Yes inside deposit cadence window (regardless of FU date)
 *   - Phase-stale leads (last-touch exceeded the phase max-gap)
 *
 * Excluded:
 *   - Future Next-FU > today (system says "wait" — respect it)
 *   - Terminal stages (Won / Lost / Archived)
 *   - Healthy cadence with no urgent signal
 *
 * Sort key: unified priority score (single number). Higher = more urgent.
 * Same scoring philosophy as `TopPicks.tsx` rankPicks, extended to the
 * full qualifying queue.
 */

import type { ScoredOpportunity } from "./types";
import { salesPhase } from "./salesCadence";

export interface FocusQueueItem {
  opp: ScoredOpportunity;
  score: number;
  reason: string;
  reasonKind: FocusReasonKind;
}

export type FocusReasonKind =
  | "promise-overdue"
  | "promise-today"
  | "verbal-yes-overdue"
  | "verbal-yes-deposit"
  | "hot-overdue"
  | "warm-overdue"
  | "cool-overdue"
  | "due-today"
  | "phase-stale";

export type FocusScope = "today" | "top25" | "verbal-yes" | "all-overdue";

export interface BuildOpts {
  scope?: FocusScope;
  today: string;          // ISO YYYY-MM-DD in Vancouver TZ
}

export function buildFocusQueue(
  active: ScoredOpportunity[],
  opts: BuildOpts
): FocusQueueItem[] {
  const { today, scope = "today" } = opts;
  const items: FocusQueueItem[] = [];

  for (const opp of active) {
    const item = scoreForFocus(opp, today);
    if (!item) continue;
    items.push(item);
  }

  let filtered = items;
  if (scope === "verbal-yes") {
    filtered = items.filter((i) => i.opp.stage === "Verbal Yes");
  } else if (scope === "all-overdue") {
    filtered = items.filter((i) =>
      i.reasonKind === "promise-overdue" ||
      i.reasonKind === "verbal-yes-overdue" ||
      i.reasonKind === "hot-overdue" ||
      i.reasonKind === "warm-overdue" ||
      i.reasonKind === "cool-overdue"
    );
  } else if (scope === "top25") {
    // No filter — just take top 25 across whole pipeline
    filtered = items;
  }
  // scope === "today" → use all qualifying items (default)

  // Sort by score desc, then by est-value desc, then by name asc — stable.
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.opp.estValue !== a.opp.estValue) return b.opp.estValue - a.opp.estValue;
    return a.opp.name.localeCompare(b.opp.name);
  });

  if (scope === "top25") return filtered.slice(0, 25);
  return filtered;
}

/**
 * Score one opportunity for focus-mode inclusion.
 * Returns null if the lead shouldn't be on today's call list.
 *
 * Weights (higher = call sooner):
 *   - Promise overdue: 1000 + days-late
 *   - Promise today:   950
 *   - Verbal Yes overdue: 900 + days-since-touch
 *   - Hot + overdue:   500 + days-late + log10(value)*20
 *   - Warm + overdue:  400 + days-late
 *   - Cool/Cold + overdue: 300 + days-late
 *   - Verbal Yes inside deposit cadence (D0/2/4/7/11/14): 450
 *   - Due today (no overdue): 200 + heat_bonus + log10(value)*15
 *   - Phase-stale (last-touch > max-gap, no explicit FU set): 250 + stale_days
 */
function scoreForFocus(opp: ScoredOpportunity, today: string): FocusQueueItem | null {
  // Terminal stages excluded
  if (opp.stage === "Won" || opp.stage === "Lost" || opp.stage === "Archived") return null;

  // Already touched today → exclude from focus queue. The smart-snooze
  // pushed next-FU forward when the touch was logged; surfacing them
  // again the same day would re-queue calls Jared just made (e.g. a
  // VM at 9am shouldn't trigger another Call suggestion at 2pm).
  // If he genuinely wants to follow up the same day, the regular
  // Pipeline view + drawer is the right place — Focus Mode is the
  // "what's next, untouched" queue.
  if (opp.lastTouchDate === today) return null;

  // ===== PROMISES =====
  // Only compare promisedTime if it's a parseable ISO date — promisedTime
  // can be free-text like "Monday 3pm" which localeCompare misinterprets.
  if (opp.promise && opp.promisedTime && /^\d{4}-\d{2}-\d{2}/.test(opp.promisedTime)) {
    const promiseDate = opp.promisedTime.slice(0, 10);
    const cmp = compareDate(promiseDate, today);
    if (cmp < 0) {
      const daysLate = Math.abs(daysBetween(promiseDate, today));
      return {
        opp,
        score: 1000 + Math.min(daysLate, 14),
        reason: `Promise ${daysLate}d overdue · ${opp.stage}`,
        reasonKind: "promise-overdue",
      };
    }
    if (cmp === 0) {
      return {
        opp,
        score: 950,
        reason: `Promise due today · ${opp.stage}`,
        reasonKind: "promise-today",
      };
    }
    // promise in future — fall through to other checks
  } else if (opp.promise) {
    // Free-text promise (e.g. "Monday 3pm") — treat as today-or-recent,
    // surface as promise-today so Jared sees it but with lower confidence
    return {
      opp,
      score: 920,
      reason: `Promise pending · ${opp.promisedTime || opp.stage}`,
      reasonKind: "promise-today",
    };
  }

  // ===== VERBAL YES (special — deposit collection) =====
  if (opp.stage === "Verbal Yes") {
    const phase = salesPhase(opp, today);
    const lastDays = opp.lastTouchDate ? daysBetween(opp.lastTouchDate, today) : 999;
    // Verbal Yes overdue FU
    if (opp.nextFollowUpDate) {
      const fuCmp = compareDate(opp.nextFollowUpDate, today);
      if (fuCmp <= 0) {
        return {
          opp,
          score: 900 + Math.min(lastDays, 14) + valueBoost(opp.estValue, 10),
          reason: `Verbal Yes · ${lastDays}d since touch — deposit at risk`,
          reasonKind: "verbal-yes-overdue",
        };
      }
    }
    // Verbal Yes inside deposit cadence (D0/2/4/7/11/14 from last touch)
    if ([0, 2, 4, 7, 11, 14].includes(lastDays) || lastDays > phase.maxGapDays) {
      const isNeverTouched = lastDays === 999;
      return {
        opp,
        score: 450 + valueBoost(opp.estValue, 10),
        reason: isNeverTouched
          ? `Verbal Yes · never touched — start deposit cadence`
          : `Verbal Yes · deposit cadence (Day ${lastDays})`,
        reasonKind: "verbal-yes-deposit",
      };
    }
    // VY but not yet due — fall through
  }

  // ===== NEXT-FU =====
  if (opp.nextFollowUpDate) {
    const cmp = compareDate(opp.nextFollowUpDate, today);
    if (cmp < 0) {
      // Overdue
      const daysLate = Math.abs(daysBetween(opp.nextFollowUpDate, today));
      const heat = opp.heat.tier;
      let base = 300;
      let kind: FocusReasonKind = "cool-overdue";
      if (heat === "hot") {
        base = 500;
        kind = "hot-overdue";
      } else if (heat === "warm") {
        base = 400;
        kind = "warm-overdue";
      }
      return {
        opp,
        score: base + Math.min(daysLate, 30) + valueBoost(opp.estValue, 20),
        reason: `Overdue ${daysLate}d · ${heat} · ${opp.stage}`,
        reasonKind: kind,
      };
    }
    if (cmp === 0) {
      // Due today
      const heatBonus = opp.heat.tier === "hot" ? 100 : opp.heat.tier === "warm" ? 50 : 0;
      return {
        opp,
        score: 200 + heatBonus + valueBoost(opp.estValue, 15),
        reason: `Due today · ${opp.heat.tier} · ${opp.stage}`,
        reasonKind: "due-today",
      };
    }
    // Future FU — not on today's queue
    return null;
  }

  // ===== NO NEXT-FU SET — phase-stale check =====
  // If no FU exists and last-touch exceeded phase max-gap, surface it
  const phase = salesPhase(opp, today);
  if (opp.lastTouchDate) {
    const lastDays = daysBetween(opp.lastTouchDate, today);
    if (lastDays > phase.maxGapDays) {
      return {
        opp,
        score: 250 + Math.min(lastDays, 60),
        reason: `${lastDays}d since touch · past ${phase.label} max`,
        reasonKind: "phase-stale",
      };
    }
  } else {
    // No touch ever logged on a non-terminal opp → flag once
    return {
      opp,
      score: 280,
      reason: `No touch logged · ${opp.stage}`,
      reasonKind: "phase-stale",
    };
  }

  return null;
}

function valueBoost(value: number, multiplier: number): number {
  if (!value || value <= 0) return 0;
  return Math.log10(value) * multiplier;
}

function compareDate(a: string, b: string): number {
  return a.localeCompare(b);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
