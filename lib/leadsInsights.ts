/**
 * Leads dashboard scoring + signals + headline. The PRIMARY value of the
 * Leads dashboard is TopPicks ranking — "what should I call right now?"
 * Everything here serves that question.
 *
 * Priority weights (per Jared 2026-05-11):
 *   +1100  Callback requested + time = now OR past
 *   +1000  Estimate booked, visit date passed without promote
 *   +950   New + 0 attempts + >24 business hours (SLA blown)
 *   +900   Reschedule count ≥ 2 AND visit <= 7d
 *   +850   Setup call pending + estimate visit <= 3d
 *   +800   Long-term hold + reach-out date <= today + 3d
 *   +750   New + 0 attempts + same business day (still in business hours)
 *   +700   Estimate booked + visit tomorrow + no touch today
 *   +650   Callback requested + time within next 4hr
 *   +500   Attempted contact + 3+ attempts + no reply 3d+
 *   +350   Estimate booked + visit = today
 */

import type { Lead, ScoredLead, LeadStaleSignal, LeadStage, LeadsHealth, LeadsHeadline, LeadsDashboardData } from "./types";
import { LEAD_STAGES } from "./types";

const TZ = "America/Vancouver";

export function buildLeadsData(leads: Lead[]): LeadsDashboardData {
  const today = todayISO();
  const scored: ScoredLead[] = leads.map((l) => scoreLead(l, today));
  const active = scored.filter((l) => l.stage !== "Lost");

  // Top 3 by priority — only from active set with priorityScore > 0
  const topPicks = [...active]
    .filter((l) => l.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);

  const health = computeHealth(active, today);
  const headline = computeHeadline(active, today);

  return {
    all: scored,
    active,
    topPicks,
    health,
    headline,
    generatedAt: new Date().toISOString(),
  };
}

export function scoreLead(lead: Lead, today: string): ScoredLead {
  const reasons: string[] = [];
  const signals: LeadStaleSignal[] = [];
  let score = 0;

  // ===================== Callback requested =====================
  if (lead.stage === "Callback requested" && lead.callbackTime) {
    const cbStatus = parseCallbackTimeStatus(lead.callbackTime, today);
    if (cbStatus === "now-or-past") {
      score += 1100;
      reasons.push("Callback overdue or due now");
      signals.push({ key: "callback-due", label: "Callback due", severity: "rose", reason: `Promised ${lead.callbackTime}` });
    } else if (cbStatus === "soon") {
      score += 650;
      reasons.push("Callback in the next few hours");
      signals.push({ key: "callback-due", label: "Callback soon", severity: "amber", reason: `Promised ${lead.callbackTime}` });
    }
  }

  // ===================== Estimate booked — passed without promote =====================
  if (lead.stage === "Estimate booked" && lead.estimateVisitDate) {
    const d = daysBetween(today, lead.estimateVisitDate);
    if (d < 0) {
      score += 1000;
      reasons.push(`Visit was ${Math.abs(d)}d ago — did it happen?`);
      signals.push({
        key: "estimate-didnt-happen",
        label: "Estimate didn't happen?",
        severity: "rose",
        reason: `Visit date ${lead.estimateVisitDate} is past with no promote to Pipeline.`,
      });
    } else if (d === 0) {
      score += 350;
      reasons.push("Estimate visit today");
    } else if (d === 1) {
      const touchedToday = lead.lastTouchDate === today;
      if (!touchedToday) {
        score += 700;
        reasons.push("Visit tomorrow — confirm");
        signals.push({
          key: "day-before-confirmation",
          label: "Day-before confirmation",
          severity: "rose",
          reason: `Visit ${lead.estimateVisitDate}; no touch today.`,
        });
      }
    }

    // Setup call pending close to visit
    if (!lead.setupCallDone && d >= 0 && d <= 3) {
      score += 850;
      reasons.push("Setup call pending");
      signals.push({
        key: "setup-call-pending",
        label: "Setup call pending",
        severity: "rose",
        reason: `Visit ${lead.estimateVisitDate}; setup call not done.`,
      });
    } else if (!lead.setupCallDone && d > 3 && d <= 7) {
      signals.push({
        key: "setup-call-pending",
        label: "Setup call pending",
        severity: "amber",
        reason: `Visit ${lead.estimateVisitDate}; schedule setup call.`,
      });
    }

    // Reschedule-prone
    if (lead.rescheduleCount >= 2 && d >= 0 && d <= 7) {
      score += 900;
      reasons.push(`Reschedule-prone (${lead.rescheduleCount}x)`);
      signals.push({
        key: "reschedule-prone",
        label: `Rescheduled ${lead.rescheduleCount}x`,
        severity: "amber",
        reason: "Likely to slip — confirm with extra care.",
      });
    }

    // Estimate pending long — far-out visit going cold
    if (d > 14 && (!lead.lastTouchDate || daysBetween(lead.lastTouchDate, today) >= 7)) {
      signals.push({
        key: "estimate-pending-long",
        label: "No touch in 7d+",
        severity: "amber",
        reason: "Light reassurance touch overdue.",
      });
    }
  }

  // ===================== New — speed-to-contact SLA =====================
  if (lead.stage === "New" && lead.contactAttempts === 0) {
    const inquiry = lead.firstInquiryDate;
    if (inquiry) {
      const days = daysBetween(inquiry, today);
      if (days >= 1) {
        score += 950;
        reasons.push(`>${days}d, never reached — SLA blown`);
        signals.push({
          key: "never-reached",
          label: "Never reached",
          severity: "rose",
          reason: "Same-day ideal, 24hr hard max.",
        });
      } else {
        score += 750;
        reasons.push("Same-day inbound — call before EOD");
        signals.push({
          key: "inbound-today",
          label: "Inbound today",
          severity: "amber",
          reason: "Same-day contact goal.",
        });
      }
    } else {
      // No inquiry date — assume needs reaching
      score += 600;
      reasons.push("New — needs first touch");
    }
  }

  // ===================== Long-term hold — reach-out approaching =====================
  if (lead.stage === "Long-term hold" && lead.longTermReachOutDate) {
    const d = daysBetween(today, lead.longTermReachOutDate);
    if (d <= 3) {
      score += 800;
      reasons.push(d < 0 ? `Reach-out ${Math.abs(d)}d overdue` : "Long-term reach-out due");
      signals.push({
        key: "long-term-reachout-due",
        label: "Long-term reach-out due",
        severity: "rose",
        reason: `Reach-out date ${lead.longTermReachOutDate}.`,
      });
    } else if (d <= 14) {
      signals.push({
        key: "long-term-reachout-due",
        label: "Long-term reach-out soon",
        severity: "amber",
        reason: `Reach-out date ${lead.longTermReachOutDate}.`,
      });
    }
  }

  // ===================== Attempted contact — ghost candidate =====================
  if (lead.stage === "Attempted contact") {
    const lastTouchDays = lead.lastTouchDate ? daysBetween(lead.lastTouchDate, today) : null;
    if (lead.contactAttempts >= 3 && (lastTouchDays == null || lastTouchDays >= 3)) {
      score += 500;
      reasons.push("Ghost — switch channel");
      signals.push({
        key: "ghost-candidate",
        label: "Ghost candidate",
        severity: "rose",
        reason: `${lead.contactAttempts} attempts, no reply.`,
      });
    } else if (lead.contactAttempts < 3) {
      score += 300;
      reasons.push("Try again");
    }
  }

  // ===================== Generic stale — last touch >14d, non-terminal =====================
  if (lead.lastTouchDate && lead.stage !== "Lost" && lead.stage !== "Long-term hold") {
    const d = daysBetween(lead.lastTouchDate, today);
    if (d > 14 && signals.length === 0) {
      score += 200;
      signals.push({
        key: "stale-generic",
        label: `${d}d no touch`,
        severity: "amber",
        reason: "Catch-all stale signal.",
      });
    }
  }

  return {
    ...lead,
    priorityScore: score,
    priorityReasons: reasons.slice(0, 2),
    staleSignals: signals,
  };
}

/**
 * Callback time parser — tolerant. The field can be a date+time ISO
 * string or free text like "Mon 3pm", "tomorrow morning", "this afternoon".
 * For free-text values we conservatively flag as "now-or-past" only if
 * the parser can confidently extract a date+time; otherwise "soon".
 */
function parseCallbackTimeStatus(raw: string, today: string): "now-or-past" | "soon" | "later" {
  const t = (raw || "").trim();
  if (!t) return "later";
  // Try ISO datetime
  const isoMatch = t.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (isoMatch) {
    const date = isoMatch[1];
    const hour = isoMatch[2] ? parseInt(isoMatch[2], 10) : 12;
    const minute = isoMatch[3] ? parseInt(isoMatch[3], 10) : 0;
    const targetMs = new Date(date + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00-08:00").getTime();
    const nowMs = Date.now();
    const diffMin = (targetMs - nowMs) / 60000;
    if (diffMin <= 15) return "now-or-past";
    if (diffMin <= 240) return "soon";
    return "later";
  }
  // Free text: if it mentions today/now, treat as soon; if it's a past day word, now-or-past
  const lower = t.toLowerCase();
  if (/\b(now|asap)\b/.test(lower)) return "now-or-past";
  if (/\b(today|this morning|this afternoon|this evening|tonight)\b/.test(lower)) {
    // Treat any today-text as "soon" so it surfaces; user can fine-tune via the actual time field
    return "soon";
  }
  // Date prefix like "2026-05-12" plain — compare to today
  const dateMatch = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const cmp = dateMatch[1];
    if (cmp < today) return "now-or-past";
    if (cmp === today) return "soon";
  }
  return "later";
}

function computeHealth(active: ScoredLead[], today: string): LeadsHealth {
  const byStage: Record<LeadStage, number> = {
    "New": 0,
    "Attempted contact": 0,
    "Callback requested": 0,
    "Estimate booked": 0,
    "Long-term hold": 0,
    "Lost": 0,
  };
  let callbackDue = 0;
  let neverReached = 0;
  let inboundToday = 0;
  let ghosting = 0;
  let estimateThisWeek = 0;
  let setupCallsPending = 0;
  let longTermReachoutsDue = 0;
  let stale = 0;

  for (const l of active) {
    if (l.stage in byStage) byStage[l.stage as LeadStage]++;

    if (l.staleSignals.some((s) => s.key === "callback-due" && s.severity === "rose")) callbackDue++;
    if (l.staleSignals.some((s) => s.key === "never-reached")) neverReached++;
    if (l.staleSignals.some((s) => s.key === "inbound-today")) inboundToday++;
    if (l.staleSignals.some((s) => s.key === "ghost-candidate")) ghosting++;
    if (l.stage === "Estimate booked" && l.estimateVisitDate) {
      const d = daysBetween(today, l.estimateVisitDate);
      if (d >= 0 && d <= 7) estimateThisWeek++;
    }
    if (l.staleSignals.some((s) => s.key === "setup-call-pending")) setupCallsPending++;
    if (l.staleSignals.some((s) => s.key === "long-term-reachout-due")) longTermReachoutsDue++;
    if (l.lastTouchDate && daysBetween(l.lastTouchDate, today) > 14 && l.stage !== "Long-term hold") stale++;
  }

  return {
    activeCount: active.length,
    byStage,
    callbackDue,
    neverReached,
    inboundToday,
    ghosting,
    estimateThisWeek,
    setupCallsPending,
    longTermReachoutsDue,
    stale,
  };
}

function computeHeadline(active: ScoredLead[], today: string): LeadsHeadline {
  // Priority: callback overdue > estimate didn't happen > never reached >
  // setup call pending > inbound today > nothing
  const callbackDue = active.filter((l) =>
    l.staleSignals.some((s) => s.key === "callback-due" && s.severity === "rose")
  );
  if (callbackDue.length > 0) {
    return {
      emoji: "📞",
      tone: "danger",
      text: `${callbackDue.length} callback${callbackDue.length === 1 ? "" : "s"} overdue — call now`,
      relatedLabel: "Callbacks due",
      relatedLeads: callbackDue.slice(0, 5),
    };
  }
  const estDidntHappen = active.filter((l) =>
    l.staleSignals.some((s) => s.key === "estimate-didnt-happen")
  );
  if (estDidntHappen.length > 0) {
    return {
      emoji: "🤔",
      tone: "warning",
      text: `${estDidntHappen.length} estimate visit${estDidntHappen.length === 1 ? "" : "s"} passed — did they happen?`,
      relatedLabel: "Visit dates passed",
      relatedLeads: estDidntHappen.slice(0, 5),
    };
  }
  const neverReached = active.filter((l) =>
    l.staleSignals.some((s) => s.key === "never-reached")
  );
  if (neverReached.length > 0) {
    return {
      emoji: "🚨",
      tone: "danger",
      text: `${neverReached.length} lead${neverReached.length === 1 ? "" : "s"} past first-touch SLA — reach today`,
      relatedLabel: "Never reached",
      relatedLeads: neverReached.slice(0, 5),
    };
  }
  const setupPending = active.filter((l) =>
    l.staleSignals.some((s) => s.key === "setup-call-pending" && s.severity === "rose")
  );
  if (setupPending.length > 0) {
    return {
      emoji: "🎯",
      tone: "warning",
      text: `${setupPending.length} setup call${setupPending.length === 1 ? "" : "s"} pending — qualify before the visit`,
      relatedLabel: "Setup calls pending",
      relatedLeads: setupPending.slice(0, 5),
    };
  }
  const inboundToday = active.filter((l) =>
    l.staleSignals.some((s) => s.key === "inbound-today")
  );
  if (inboundToday.length > 0) {
    return {
      emoji: "⚡",
      tone: "warning",
      text: `${inboundToday.length} new lead${inboundToday.length === 1 ? "" : "s"} today — reach before EOD`,
      relatedLabel: "New today",
      relatedLeads: inboundToday.slice(0, 5),
    };
  }
  if (active.length === 0) {
    return {
      emoji: "🌱",
      tone: "neutral",
      text: "No active leads. Quiet day — keep prospecting.",
      relatedLabel: "",
      relatedLeads: [],
    };
  }
  return {
    emoji: "✅",
    tone: "good",
    text: `${active.length} active lead${active.length === 1 ? "" : "s"} on track. No urgent fires.`,
    relatedLabel: "",
    relatedLeads: [],
  };
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function todayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
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
