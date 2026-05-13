import type { ScoredOpportunity, Stage } from "./types";
import { daysBetween, todayISO } from "./utils";

export interface Headline {
  emoji: string;
  text: string;
  tone: "danger" | "warning" | "good" | "neutral";
  // Underlying opps the headline is summarizing — surfaces on click-expand
  // so the user can drill into the actual people behind the number.
  relatedOpps: ScoredOpportunity[];
  relatedLabel: string;  // What the list shows (e.g. "Promises overdue + VY stale")
}

export interface SmartInsight {
  id: string;
  headline: string;
  detail: string;
  opp?: ScoredOpportunity;
  tone: "danger" | "warning" | "opportunity" | "good";
  action: string;
}

export interface FunnelStage {
  stage: Stage;
  count: number;
  value: number;
}

/** Headline panel — the one sentence that punches you in the face on open. */
export function computeHeadline(active: ScoredOpportunity[]): Headline {
  const today = todayISO();
  const promisesOverdue = active.filter(
    (o) => o.promise && o.nextFollowUpDate && o.nextFollowUpDate < today
  );
  const vyStale = active.filter(
    (o) =>
      o.stage === "Verbal Yes" &&
      (!o.lastTouchDate || daysBetween(o.lastTouchDate, today) > 14)
  );
  const valueAtRisk =
    promisesOverdue.reduce((acc, o) => acc + o.estValue, 0) +
    vyStale.reduce((acc, o) => acc + o.estValue, 0);

  if (promisesOverdue.length > 0 || vyStale.length > 0) {
    const parts: string[] = [];
    if (promisesOverdue.length > 0) {
      parts.push(
        `${promisesOverdue.length} promise${promisesOverdue.length === 1 ? "" : "s"} overdue`
      );
    }
    if (vyStale.length > 0) {
      parts.push(
        `${vyStale.length} verbal yes${vyStale.length === 1 ? "" : "es"} stale (${vyStale.length === 1 ? "untouched" : "all untouched"} 14d+)`
      );
    }
    // Combine + dedupe (a deal could be both promise-overdue AND VY-stale)
    const combined = Array.from(
      new Map([...promisesOverdue, ...vyStale].map((o) => [o.id || o.name, o])).values()
    );
    return {
      emoji: "🚨",
      text: `${parts.join(" · ")} — $${formatK(valueAtRisk)} at risk.`,
      tone: "danger",
      relatedOpps: combined,
      relatedLabel:
        promisesOverdue.length > 0 && vyStale.length > 0
          ? "Promises overdue + Verbal Yes stale"
          : promisesOverdue.length > 0
            ? "Promises overdue"
            : "Verbal Yes stale (>14d)",
    };
  }

  const today_actions = active.filter(
    (o) => o.nextFollowUpDate === today
  );
  if (today_actions.length > 0) {
    const todayValue = today_actions.reduce((acc, o) => acc + o.estValue, 0);
    return {
      emoji: "📋",
      text: `${today_actions.length} follow-up${today_actions.length === 1 ? "" : "s"} due today — $${formatK(todayValue)} in play.`,
      tone: "warning",
      relatedOpps: today_actions,
      relatedLabel: "Follow-ups due today",
    };
  }

  const hot = active.filter((o) => o.heat.tier === "hot");
  if (hot.length > 0) {
    const hotValue = hot.reduce((acc, o) => acc + o.estValue, 0);
    return {
      emoji: "🔥",
      text: `${hot.length} hot lead${hot.length === 1 ? "" : "s"} active — $${formatK(hotValue)} in close range.`,
      tone: "good",
      relatedOpps: hot,
      relatedLabel: "Hot leads",
    };
  }

  return {
    emoji: "✨",
    text: "No urgent actions. Pipeline is calm.",
    tone: "neutral",
    relatedOpps: [],
    relatedLabel: "",
  };
}

/** Smart insights — top 3 next-best actions for today. */
export function computeSmartInsights(active: ScoredOpportunity[]): SmartInsight[] {
  const today = todayISO();
  const insights: SmartInsight[] = [];

  // 1. Stale Verbal Yes — single highest priority
  const staleVy = active
    .filter(
      (o) =>
        o.stage === "Verbal Yes" &&
        (!o.lastTouchDate || daysBetween(o.lastTouchDate, today) > 10)
    )
    .sort(
      (a, b) =>
        (a.lastTouchDate ? daysBetween(a.lastTouchDate, today) : 999) -
        (b.lastTouchDate ? daysBetween(b.lastTouchDate, today) : 999)
    );
  for (const o of staleVy.slice(0, 2)) {
    const days = o.lastTouchDate ? daysBetween(o.lastTouchDate, today) : null;
    insights.push({
      id: `vy-stale-${o.id || o.name}`,
      headline: `${o.name} — Verbal Yes, ${days != null ? `${days}d cold` : "no touch on record"}`,
      detail: `$${formatK(o.estValue)} verbal yes hasn't been touched ${days != null ? `in ${days} days` : "yet"}. Highest leverage call today.`,
      opp: o,
      tone: "danger",
      action: "Call now",
    });
  }

  // 2. Promises overdue (not already covered by VY)
  const promisesOverdue = active
    .filter(
      (o) =>
        o.promise &&
        o.nextFollowUpDate &&
        o.nextFollowUpDate < today &&
        !insights.some((i) => i.opp?.id === o.id)
    )
    .sort((a, b) => (a.nextFollowUpDate || "").localeCompare(b.nextFollowUpDate || ""));
  for (const o of promisesOverdue.slice(0, 2)) {
    const promisedISO = o.nextFollowUpDate || "";
    const days = promisedISO ? daysBetween(promisedISO, today) : 0;
    insights.push({
      id: `promise-overdue-${o.id || o.name}`,
      headline: `${o.name} — promised ${days}d ago, no follow-up logged`,
      detail: `You committed to ${o.nextFollowUpType.toLowerCase() || "follow up"} on ${promisedISO}. Trust at stake.`,
      opp: o,
      tone: "warning",
      action: "Follow through",
    });
  }

  // 3. Highest-value Hot lead due soon (not already covered)
  const hotDueSoon = active
    .filter(
      (o) =>
        o.heat.tier === "hot" &&
        o.nextFollowUpDate &&
        daysBetween(today, o.nextFollowUpDate) >= 0 &&
        daysBetween(today, o.nextFollowUpDate) <= 3 &&
        !insights.some((i) => i.opp?.id === o.id)
    )
    .sort((a, b) => b.estValue - a.estValue);
  for (const o of hotDueSoon.slice(0, 1)) {
    const daysFromNow = daysBetween(today, o.nextFollowUpDate || today);
    insights.push({
      id: `hot-soon-${o.id || o.name}`,
      headline: `${o.name} — $${formatK(o.estValue)} hot lead, follow up ${daysFromNow === 0 ? "today" : `in ${daysFromNow}d`}`,
      detail: o.heat.topReason,
      opp: o,
      tone: "opportunity",
      action: "Open lead",
    });
  }

  return insights.slice(0, 3);
}

/** Conversion funnel: live counts of active opps by stage. */
export function computeFunnel(active: ScoredOpportunity[]): FunnelStage[] {
  const order: Stage[] = [
    "Proposal Sent",
    "Verbal Yes",
  ];
  const counts: Record<Stage, FunnelStage> = {} as Record<Stage, FunnelStage>;
  for (const s of order) counts[s] = { stage: s, count: 0, value: 0 };
  for (const o of active) {
    if (counts[o.stage]) {
      counts[o.stage].count++;
      counts[o.stage].value += o.estValue;
    }
  }
  return order.map((s) => counts[s]);
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(Math.round(n));
}
