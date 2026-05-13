import type { Opportunity } from "./types";
import { daysBetween, todayISO } from "./utils";
import { isActive } from "./bucketing";

/**
 * Focus Mode queue — one opportunity at a time in priority order.
 *
 * Priority (highest first):
 *   1. Verbal Yes deals  (closest to revenue)
 *   2. Overdue follow-ups, biggest est value first
 *   3. Due today, biggest est value first
 *   4. Due this week, biggest est value first
 *
 * Logged-today opportunities are EXCLUDED so you don't call the same
 * person twice in a day. This is non-negotiable — if someone was just
 * called this morning the queue must not surface them again.
 */
export function buildFocusQueue(opps: Opportunity[]): Opportunity[] {
  const today = todayISO();
  const active = opps.filter(isActive);

  // Anyone touched today is OUT of the queue.
  const untouchedToday = active.filter((o) => o.lastTouchDate !== today);

  function priority(o: Opportunity): number {
    if (o.stage === "Verbal Yes") return 0;
    if (!o.nextFollowUpDate) return 999;
    const diff = daysBetween(today, o.nextFollowUpDate);
    if (diff < 0) return 1; // overdue
    if (diff === 0) return 2;
    if (diff <= 7) return 3;
    if (diff <= 14) return 4;
    return 5;
  }

  return untouchedToday.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return b.estValue - a.estValue;
  });
}
