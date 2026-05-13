import type {
  ActionZone,
  ArchiveRecord,
  DashboardData,
  DateBucket,
  DateBucketKey,
  HeatBucket,
  Opportunity,
  PipelineHealth,
  ScoredOpportunity,
} from "./types";
import { computeHeat, type HeatTier } from "./heat";
import { computeFunnel, computeHeadline, computeSmartInsights } from "./insights";
import { daysBetween, todayISO } from "./utils";

const ACTIVE_STAGES = new Set([
  "Proposal Sent",
  "Verbal Yes",
  "On Hold",
  "Long-Term",
]);
const TERMINAL_STAGES = new Set(["Won", "Lost", "Archived"]);

export function isActive(opp: Opportunity): boolean {
  if (TERMINAL_STAGES.has(opp.stage)) return false;
  return ACTIVE_STAGES.has(opp.stage) || opp.stage === "Unknown";
}

const sortHotToCold = (a: ScoredOpportunity, b: ScoredOpportunity) =>
  b.heat.score - a.heat.score || b.estValue - a.estValue;

const sortByDate = (a: ScoredOpportunity, b: ScoredOpportunity) => {
  const aDate = a.nextFollowUpDate || "9999-99-99";
  const bDate = b.nextFollowUpDate || "9999-99-99";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return sortHotToCold(a, b);
};

const sortPromisedFirst = (a: ScoredOpportunity, b: ScoredOpportunity) => {
  if (a.promise !== b.promise) return a.promise ? -1 : 1;
  if (a.promisedTime !== b.promisedTime) {
    const aTime = a.promisedTime || "23:59";
    const bTime = b.promisedTime || "23:59";
    return aTime.localeCompare(bTime);
  }
  return sortHotToCold(a, b);
};

export function bucketize(
  opps: Opportunity[],
  archive: ArchiveRecord[] = []
): DashboardData {
  const today = todayISO();
  const all: ScoredOpportunity[] = opps.map((o) => ({ ...o, heat: computeHeat(o) }));
  const active = all.filter(isActive);

  // Heat buckets
  const byHeat: Record<HeatTier, ScoredOpportunity[]> = {
    hot: [],
    warm: [],
    cool: [],
    cold: [],
  };
  for (const o of active) byHeat[o.heat.tier].push(o);
  Object.values(byHeat).forEach((arr) => arr.sort(sortByDate));
  const heatBuckets: HeatBucket[] = (["hot", "warm", "cool", "cold"] as HeatTier[]).map(
    (key) => ({
      key,
      opportunities: byHeat[key],
      totalValue: byHeat[key].reduce((acc, o) => acc + o.estValue, 0),
    })
  );

  // Date buckets
  const byDate: Record<DateBucketKey, ScoredOpportunity[]> = {
    overdue: [],
    today: [],
    next7: [],
    next14: [],
    next30: [],
    next90: [],
    unscheduled: [],
  };
  for (const o of active) {
    if (!o.nextFollowUpDate) {
      byDate.unscheduled.push(o);
      continue;
    }
    const diff = daysBetween(today, o.nextFollowUpDate);
    if (diff < 0) byDate.overdue.push(o);
    else if (diff === 0) byDate.today.push(o);
    else if (diff <= 7) byDate.next7.push(o);
    else if (diff <= 14) byDate.next14.push(o);
    else if (diff <= 30) byDate.next30.push(o);
    else if (diff <= 90) byDate.next90.push(o);
    else byDate.unscheduled.push(o);
  }
  Object.values(byDate).forEach((arr) => arr.sort(sortHotToCold));
  const dateBuckets: DateBucket[] = [
    { key: "overdue", label: "Overdue", defaultExpanded: true, opportunities: byDate.overdue, totalValue: sum(byDate.overdue) },
    { key: "today", label: "Today", defaultExpanded: true, opportunities: byDate.today, totalValue: sum(byDate.today) },
    { key: "next7", label: "Next 7 days", defaultExpanded: true, opportunities: byDate.next7, totalValue: sum(byDate.next7) },
    { key: "next14", label: "Next 2 weeks", defaultExpanded: false, opportunities: byDate.next14, totalValue: sum(byDate.next14) },
    { key: "next30", label: "Next month", defaultExpanded: false, opportunities: byDate.next30, totalValue: sum(byDate.next30) },
    { key: "next90", label: "Next 3 months", defaultExpanded: false, opportunities: byDate.next90, totalValue: sum(byDate.next90) },
    { key: "unscheduled", label: "Unscheduled", defaultExpanded: false, opportunities: byDate.unscheduled, totalValue: sum(byDate.unscheduled) },
  ];

  // Action Zone — Today + Overdue + Tomorrow
  const tomorrow = addDays(today, 1);
  const actionZone: ActionZone = {
    overdue: [...byDate.overdue].sort(sortPromisedFirst),
    today: [...byDate.today].sort(sortPromisedFirst),
    tomorrow: active.filter((o) => o.nextFollowUpDate === tomorrow).sort(sortPromisedFirst),
  };

  // Pipeline health
  const heatDistribution: PipelineHealth["heatDistribution"] = {
    hot: { count: byHeat.hot.length, value: sum(byHeat.hot) },
    warm: { count: byHeat.warm.length, value: sum(byHeat.warm) },
    cool: { count: byHeat.cool.length, value: sum(byHeat.cool) },
    cold: { count: byHeat.cold.length, value: sum(byHeat.cold) },
  };

  // Win rate + bookings come from the Archive tab (where Won/Lost records live)
  const wonLast30d = archive.filter(
    (a) =>
      a.result === "Won" &&
      a.resultDate &&
      daysBetween(a.resultDate, today) >= 0 &&
      daysBetween(a.resultDate, today) <= 30
  );
  const lostLast30d = archive.filter(
    (a) =>
      a.result === "Lost" &&
      a.resultDate &&
      daysBetween(a.resultDate, today) >= 0 &&
      daysBetween(a.resultDate, today) <= 30
  );
  const closedLast30d = wonLast30d.length + lostLast30d.length;
  const winRateLast30d = closedLast30d > 0 ? wonLast30d.length / closedLast30d : null;

  // Avg days to close = no longer have estDate in archive subset, leave null for now
  // (could enrich ArchiveRecord with estDate later if useful)
  const avgDaysToClose: number | null = null;

  // This week's + month's bookings — sum Booked Value (fall back to Est Value if blank)
  const startOfWeek = mondayOfWeek(today);
  const startOfMonth = today.slice(0, 7) + "-01";
  const valueOf = (a: ArchiveRecord) => (a.bookedValue > 0 ? a.bookedValue : a.estValue);
  const thisWeekWins = archive.filter(
    (a) => a.result === "Won" && a.resultDate && a.resultDate >= startOfWeek
  );
  const thisMonthWins = archive.filter(
    (a) => a.result === "Won" && a.resultDate && a.resultDate >= startOfMonth
  );
  const thisWeekValue = thisWeekWins.reduce((acc, a) => acc + valueOf(a), 0);
  const thisMonthValue = thisMonthWins.reduce((acc, a) => acc + valueOf(a), 0);

  const promisesPending = active.filter((o) => o.promise).length;
  const rotting = active.filter((o) => {
    if (!o.lastTouchDate) return true;
    return daysBetween(o.lastTouchDate, today) > 21;
  }).length;

  // Weekly trend: snapshot of active pipeline value, by day, for last 14 days
  // Approximation: we don't have historical snapshots, so compute synthetic series
  // using the active set's age distribution. This is BEST-EFFORT and gets replaced
  // when we build a real history table.
  const weeklyTrend = synthesizeTrend(active, today, 14);

  const health: PipelineHealth = {
    activeCount: active.length,
    pipelineValue: sum(active),
    weeklyTrend,
    heatDistribution,
    winRateLast30d,
    avgDaysToClose,
    thisWeekBookings: thisWeekWins.length,
    thisWeekBookingsValue: thisWeekValue,
    thisMonthBookingsValue: thisMonthValue,
    promisesPending,
    rotting,
  };

  return {
    all,
    active,
    archive,
    actionZone,
    heatBuckets,
    dateBuckets,
    health,
    headline: computeHeadline(active),
    smartInsights: computeSmartInsights(active),
    funnel: computeFunnel(active),
    generatedAt: new Date().toISOString(),
  };
}

function sum(opps: Opportunity[]): number {
  return opps.reduce((acc, o) => acc + o.estValue, 0);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function synthesizeTrend(
  active: ScoredOpportunity[],
  today: string,
  days: number
): { date: string; value: number }[] {
  // For each historical day, count opportunities whose estDate <= that day
  // and they're still active today. Imperfect but gives a useful shape.
  const out: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const value = active
      .filter((o) => !o.estDate || o.estDate <= d)
      .reduce((acc, o) => acc + o.estValue, 0);
    out.push({ date: d, value });
  }
  return out;
}
