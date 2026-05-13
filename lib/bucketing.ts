import type { DashboardData, Opportunity } from "./types";
import { daysBetween, todayISO } from "./utils";

const ACTIVE_STAGES = new Set([
  "Initial Contact",
  "Phone Conversation",
  "Quote Sent",
  "Verbal Yes",
  "On Hold",
]);
const TERMINAL_STAGES = new Set(["Booked", "Lost"]);

export function isActive(opp: Opportunity): boolean {
  if (TERMINAL_STAGES.has(opp.stage)) return false;
  return ACTIVE_STAGES.has(opp.stage);
}

export type BucketKey =
  | "overdue"
  | "today"
  | "next7"
  | "next14"
  | "next30"
  | "next90"
  | "unscheduled";

export const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  next7: "Next 7 days",
  next14: "Next 2 weeks",
  next30: "Next month",
  next90: "Next 3 months",
  unscheduled: "Unscheduled",
};

function bucketFor(opp: Opportunity, today: string): BucketKey {
  if (!opp.nextFollowUpDate) return "unscheduled";
  const diff = daysBetween(today, opp.nextFollowUpDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "next7";
  if (diff <= 14) return "next14";
  if (diff <= 30) return "next30";
  if (diff <= 90) return "next90";
  return "unscheduled";
}

/**
 * Group active opportunities by when next follow-up is due.
 * Verbal Yes deals are surfaced as a separate pinned rail in the UI —
 * see app/opportunities/page.tsx for how to render that on top.
 */
export function bucketize(opps: Opportunity[]): DashboardData {
  const today = todayISO();
  const active = opps.filter(isActive);
  const byBucket: Record<string, Opportunity[]> = {
    overdue: [],
    today: [],
    next7: [],
    next14: [],
    next30: [],
    next90: [],
    unscheduled: [],
  };
  for (const opp of active) {
    const key = bucketFor(opp, today);
    byBucket[key].push(opp);
  }
  // Within each bucket, soonest follow-up first; then highest est value.
  for (const key of Object.keys(byBucket)) {
    byBucket[key].sort((a, b) => {
      const aDate = a.nextFollowUpDate || "9999-99-99";
      const bDate = b.nextFollowUpDate || "9999-99-99";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return b.estValue - a.estValue;
    });
  }
  return { active, byBucket };
}
