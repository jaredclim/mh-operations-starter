/**
 * Leads (pre-estimate) cadence engine. Sibling to:
 *   - lib/commsCadence.ts  (Production)
 *   - lib/salesCadence.ts  (Pipeline, post-estimate)
 *
 * Drives:
 *   - Cadence chip / state on lead cards + drawer
 *   - Smart next-touch suggestion on quick-log
 *   - Stale-signal detection
 *
 * Anchored on Jared's actual workflow (revised 2026-05-11):
 *   Same-day inbound contact is the goal. 24 business hours is the hard
 *   max. Cadence after that is stage-driven, not flat-interval.
 */

import type { Lead, LeadStage } from "./types";

export interface LeadsCadencePhase {
  stage: LeadStage;
  label: string;
  description: string;
  guidance: string;
  suggestedNextTouchDays: number;   // Default next-touch interval from today
  minGapFromLast: number;           // Min reasonable gap between touches
  maxGapDays: number;               // Max acceptable gap before stale
}

export function leadsPhase(lead: Lead): LeadsCadencePhase {
  switch (lead.stage) {
    case "New":
      return {
        stage: "New",
        label: "New inquiry",
        description: "Inquiry just landed. No contact attempted yet.",
        guidance: "Reach SAME BUSINESS DAY. 24-business-hour hard max. Speed-to-contact is the #1 conversion lever.",
        suggestedNextTouchDays: 0,
        minGapFromLast: 0,
        maxGapDays: 1,
      };
    case "Attempted contact": {
      const attempts = lead.contactAttempts || 0;
      if (attempts >= 3) {
        return {
          stage: "Attempted contact",
          label: "Ghost candidate",
          description: `${attempts} attempts, no reply.`,
          guidance: "Switch channels — if you've been calling, try text or email. One more attempt then move to Lost.",
          suggestedNextTouchDays: 3,
          minGapFromLast: 2,
          maxGapDays: 5,
        };
      }
      return {
        stage: "Attempted contact",
        label: "Trying to reach",
        description: `${attempts} attempt${attempts === 1 ? "" : "s"} so far.`,
        guidance: "Try again within 1-2 days. Vary the channel (call → text → email). Don't burn the lead with too many calls in a row.",
        suggestedNextTouchDays: 2,
        minGapFromLast: 1,
        maxGapDays: 3,
      };
    }
    case "Callback requested":
      return {
        stage: "Callback requested",
        label: "Callback scheduled",
        description: "Client asked for a specific call-back time.",
        guidance: "Honor the requested time exactly — no earlier, no later. Set a calendar reminder.",
        suggestedNextTouchDays: 0,
        minGapFromLast: 0,
        maxGapDays: 1,
      };
    case "Estimate booked": {
      const today = todayISO();
      const visit = lead.estimateVisitDate;
      const daysToVisit = visit ? daysBetween(today, visit) : null;
      if (daysToVisit == null) {
        return {
          stage: "Estimate booked",
          label: "Estimate booked",
          description: "Estimate visit confirmed.",
          guidance: "Set the visit date. Confirm the day before. Run setup call if not done.",
          suggestedNextTouchDays: 3,
          minGapFromLast: 1,
          maxGapDays: 7,
        };
      }
      if (daysToVisit < 0) {
        return {
          stage: "Estimate booked",
          label: "Visit passed",
          description: `Visit date was ${Math.abs(daysToVisit)}d ago.`,
          guidance: "Did the estimate happen? If yes, paste opportunity to Claude (auto-promotes to Pipeline). If no, follow up immediately.",
          suggestedNextTouchDays: 0,
          minGapFromLast: 0,
          maxGapDays: 2,
        };
      }
      if (daysToVisit <= 1) {
        return {
          stage: "Estimate booked",
          label: "Visit tomorrow",
          description: "Day-before confirmation window.",
          guidance: "Send a day-before confirmation text/call. Confirm time, address, and spouse availability if applicable.",
          suggestedNextTouchDays: 0,
          minGapFromLast: 0,
          maxGapDays: 1,
        };
      }
      if (daysToVisit <= 3) {
        return {
          stage: "Estimate booked",
          label: "Visit this week",
          description: `Visit in ${daysToVisit}d.`,
          guidance: "Setup call gate. Make sure setup-call qualifier is done before showing up to the 1.5-2hr visit.",
          suggestedNextTouchDays: Math.max(0, daysToVisit - 1),
          minGapFromLast: 1,
          maxGapDays: 3,
        };
      }
      if (daysToVisit <= 7) {
        return {
          stage: "Estimate booked",
          label: "Visit next week",
          description: `Visit in ${daysToVisit}d.`,
          guidance: "Run the setup call if not done. Light touch a few days out to confirm.",
          suggestedNextTouchDays: Math.max(1, daysToVisit - 3),
          minGapFromLast: 1,
          maxGapDays: 5,
        };
      }
      return {
        stage: "Estimate booked",
        label: "Visit far out",
        description: `Visit in ${daysToVisit}d.`,
        guidance: "Light reassurance touch every 1-2 weeks. Setup call qualifier still needed.",
        suggestedNextTouchDays: 7,
        minGapFromLast: 5,
        maxGapDays: 14,
      };
    }
    case "Long-term hold": {
      const today = todayISO();
      const reach = lead.longTermReachOutDate;
      const daysToReach = reach ? daysBetween(today, reach) : null;
      if (daysToReach == null) {
        return {
          stage: "Long-term hold",
          label: "Long-term hold",
          description: "Client wants contact next calendar year+.",
          guidance: "Capture the explicit reach-out date. Then go quiet until that date approaches.",
          suggestedNextTouchDays: 60,
          minGapFromLast: 30,
          maxGapDays: 365,
        };
      }
      if (daysToReach < 0) {
        return {
          stage: "Long-term hold",
          label: "Reach-out due",
          description: `Reach-out date was ${Math.abs(daysToReach)}d ago.`,
          guidance: "Re-engage now. Use the timing they gave you as the reason for calling.",
          suggestedNextTouchDays: 0,
          minGapFromLast: 0,
          maxGapDays: 3,
        };
      }
      if (daysToReach <= 7) {
        return {
          stage: "Long-term hold",
          label: "Reach-out window",
          description: `Reach out in ${daysToReach}d.`,
          guidance: "Time to re-engage. The reach-out date IS the trigger.",
          suggestedNextTouchDays: daysToReach,
          minGapFromLast: 0,
          maxGapDays: 7,
        };
      }
      return {
        stage: "Long-term hold",
        label: "Long-term hold",
        description: `Reach out in ${daysToReach}d.`,
        guidance: "Honor the timeline. Don't call early. This will bubble to TopPicks automatically when the date approaches.",
        suggestedNextTouchDays: Math.min(60, daysToReach - 7),
        minGapFromLast: 30,
        maxGapDays: 365,
      };
    }
    case "Lost":
    default:
      return {
        stage: "Lost",
        label: "Lost",
        description: "Lead archived.",
        guidance: "No action.",
        suggestedNextTouchDays: 0,
        minGapFromLast: 0,
        maxGapDays: 0,
      };
  }
}

export type LeadsCommsLevel = "green" | "amber" | "rose" | "none";

export interface LeadsCommsState {
  level: LeadsCommsLevel;
  label: string;
  detail: string;
  phase: LeadsCadencePhase;
}

export function leadsCommsState(lead: Lead): LeadsCommsState {
  const phase = leadsPhase(lead);
  const today = todayISO();

  if (lead.stage === "Lost") {
    return { level: "none", label: "Lost", detail: "Archived.", phase };
  }

  // Callback requested → use callback time as anchor
  if (lead.stage === "Callback requested" && lead.callbackTime) {
    return {
      level: "rose",
      label: `Callback: ${lead.callbackTime}`,
      detail: `Client requested callback at ${lead.callbackTime}.`,
      phase,
    };
  }

  // New + 0 attempts — speed-to-contact SLA
  if (lead.stage === "New" && lead.contactAttempts === 0) {
    const inquiry = lead.firstInquiryDate;
    if (inquiry) {
      const days = daysBetween(inquiry, today);
      if (days >= 1) {
        return {
          level: "rose",
          label: `>${days}d, never reached`,
          detail: "First-touch SLA blown (same-day ideal, 24hr hard max).",
          phase,
        };
      }
      return {
        level: "amber",
        label: "New today",
        detail: "Contact same business day.",
        phase,
      };
    }
    return { level: "amber", label: "New — needs first touch", detail: "Reach within 24hr.", phase };
  }

  // Estimate booked — visit date drives state
  if (lead.stage === "Estimate booked" && lead.estimateVisitDate) {
    const daysToVisit = daysBetween(today, lead.estimateVisitDate);
    if (daysToVisit < 0) {
      return {
        level: "rose",
        label: `Visit ${Math.abs(daysToVisit)}d ago`,
        detail: "Did the estimate happen? Promote to Pipeline or follow up.",
        phase,
      };
    }
    if (daysToVisit === 0) {
      return { level: "amber", label: "Visit today", detail: "Day-of.", phase };
    }
    if (daysToVisit === 1) {
      return { level: "amber", label: "Visit tomorrow", detail: "Day-before confirmation.", phase };
    }
    if (daysToVisit <= 7) {
      return { level: "green", label: `Visit in ${daysToVisit}d`, detail: "On track.", phase };
    }
    return { level: "green", label: `Visit in ${daysToVisit}d`, detail: "Far out.", phase };
  }

  // Long-term hold — reach-out anchor
  if (lead.stage === "Long-term hold" && lead.longTermReachOutDate) {
    const daysToReach = daysBetween(today, lead.longTermReachOutDate);
    if (daysToReach < 0) {
      return { level: "rose", label: `Reach-out ${Math.abs(daysToReach)}d ago`, detail: "Re-engage now.", phase };
    }
    if (daysToReach <= 7) {
      return { level: "amber", label: `Reach-out in ${daysToReach}d`, detail: "Window opening.", phase };
    }
    return { level: "green", label: `Reach-out in ${daysToReach}d`, detail: "Dormant until date.", phase };
  }

  // Generic: next-touch date drives state
  if (lead.nextTouchDate) {
    const days = daysBetween(today, lead.nextTouchDate);
    if (days < 0) return { level: "rose", label: `${Math.abs(days)}d overdue`, detail: `Next was ${lead.nextTouchDate}.`, phase };
    if (days === 0) return { level: "rose", label: "Due today", detail: "Touch is due today.", phase };
    if (days <= 2) return { level: "amber", label: `Due in ${days}d`, detail: `Scheduled ${lead.nextTouchDate}.`, phase };
    return { level: "green", label: `Next in ${days}d`, detail: `Scheduled ${lead.nextTouchDate}.`, phase };
  }

  // Fallback — use last-touch staleness
  if (lead.lastTouchDate) {
    const days = daysBetween(lead.lastTouchDate, today);
    if (days > phase.maxGapDays) {
      return { level: "rose", label: `${days}d since`, detail: `Past max ${phase.maxGapDays}d gap.`, phase };
    }
    return { level: "amber", label: `${days}d since`, detail: "No next-touch set.", phase };
  }

  return { level: "amber", label: "No history", detail: "No touches logged.", phase };
}

/** Smart suggested next-touch date. Respects bucket interval AND min-gap-from-last. */
export function suggestedNextLeadTouchDate(
  lead: Lead,
  lastDateISO: string,
  today: string
): string {
  const phase = leadsPhase(lead);
  const fromToday = addDays(today, phase.suggestedNextTouchDays);
  const fromLast = addDays(lastDateISO, phase.minGapFromLast);
  const candidate = fromToday > fromLast ? fromToday : fromLast;
  return candidate < today ? today : candidate;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}
