import type { Opportunity, Stage } from "./types";
import { daysBetween, todayISO } from "./utils";

export type HeatTier = "hot" | "warm" | "cool" | "cold";

export interface Heat {
  score: number;          // 0-100
  tier: HeatTier;
  reasons: string[];      // human-readable factors that drove the score
  topReason: string;      // the single most important reason (for inline display)
}

const STAGE_BASE: Record<Stage, number> = {
  "Verbal Yes": 80,
  "Proposal Sent": 55,
  "On Hold": 30,
  "Long-Term": 20,
  Won: 100,
  Lost: 0,
  Archived: 0,
  Unknown: 30,
};

const HOT_KEYWORDS = [
  "verbal yes", "going to book", "ready to book", "ready to go", "approve",
  "approved", "deposit", "let's do it", "let's go", "go ahead", "yes let",
  "going through with", "want to move forward", "happy to proceed",
];

const COLD_KEYWORDS = [
  "next year", "later this year", "passed", "going with", "went with",
  "not at this time", "decided to go", "another company", "after we",
  "thinking about", "hold off", "not now", "spring 2027", "in the spring",
  "in the fall", "in the winter", "in the new year",
];

function scoreNoteKeywords(notes: string): { boost: number; reasons: string[] } {
  const lower = (notes || "").toLowerCase();
  let boost = 0;
  const reasons: string[] = [];
  let hotHits = 0;
  let coldHits = 0;
  for (const kw of HOT_KEYWORDS) {
    if (lower.includes(kw)) hotHits++;
  }
  for (const kw of COLD_KEYWORDS) {
    if (lower.includes(kw)) coldHits++;
  }
  if (hotHits > 0) {
    boost += Math.min(15, hotHits * 8);
    reasons.push("Hot signals in notes");
  }
  if (coldHits > 0) {
    boost -= Math.min(30, coldHits * 15);
    reasons.push("Cold signals in notes");
  }
  return { boost, reasons };
}

export function computeHeat(opp: Opportunity): Heat {
  const today = todayISO();
  const reasons: string[] = [];
  let score = STAGE_BASE[opp.stage] ?? 30;
  reasons.push(`Stage: ${opp.stage}`);

  // Promise = YES — strong boost
  if (opp.promise) {
    score += 25;
    reasons.push("Promise made");
  }

  // Recent inbound (last email received) — strongest engagement signal
  if (opp.lastEmailReceived) {
    const dRecv = daysBetween(opp.lastEmailReceived, today);
    if (dRecv >= 0 && dRecv <= 14) {
      score += 15;
      reasons.push(`Inbound email ${dRecv}d ago`);
    }
  }

  // (Spouse-at-estimate signal removed 2026-05-09 — Jared doesn't consistently
  // log spouse presence in his note style, so the boost was misleading.
  // The field still exists in the drawer for reference.)

  // Touch recency
  if (opp.lastTouchDate) {
    const dTouch = daysBetween(opp.lastTouchDate, today);
    if (dTouch >= 0 && dTouch <= 7) {
      score += 5;
      reasons.push(`Touched ${dTouch}d ago`);
    } else if (dTouch > 14) {
      const penalty = Math.min(25, dTouch - 14);
      score -= penalty;
      reasons.push(`Stale (${dTouch}d since touch)`);
    }
  } else {
    // Never touched — penalize lightly
    score -= 5;
    reasons.push("No touch on record");
  }

  // Call attempts vs response
  if (opp.callAttempts != null && opp.callAttempts > 2) {
    const penalty = (opp.callAttempts - 2) * 2;
    score -= Math.min(15, penalty);
    reasons.push(`${opp.callAttempts} call attempts`);
  }

  // Note keyword analysis
  const { boost, reasons: kwReasons } = scoreNoteKeywords(opp.notes);
  if (boost !== 0) {
    score += boost;
    reasons.push(...kwReasons);
  }

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score));

  // Tier thresholds — Jared chose looser Hot (70+) on 2026-05-09 since
  // tight 80+ was too restrictive on a 60+ opp pipeline. Hot now catches
  // Proposal Sent leads with one strong positive signal (recent inbound or
  // promise). Verbal Yes still auto-Hot from base 80.
  const tier: HeatTier =
    score >= 70 ? "hot" : score >= 50 ? "warm" : score >= 25 ? "cool" : "cold";

  // Pick the top reason for inline display
  let topReason = reasons[0] || "Unknown";
  if (opp.promise) topReason = "Promise made";
  else if (opp.stage === "Verbal Yes") topReason = "Verbal yes";
  else if (kwReasons.includes("Hot signals in notes")) topReason = "Hot signals in notes";
  else if (kwReasons.includes("Cold signals in notes")) topReason = "Cold signals in notes";
  else if (opp.lastEmailReceived) {
    const d = daysBetween(opp.lastEmailReceived, today);
    if (d >= 0 && d <= 14) topReason = `Inbound ${d}d ago`;
  } else if (opp.lastTouchDate) {
    const d = daysBetween(opp.lastTouchDate, today);
    if (d > 14) topReason = `Stale ${d}d`;
  }

  return { score, tier, reasons, topReason };
}

export const HEAT_META: Record<
  HeatTier,
  { label: string; description: string; color: string; bg: string; border: string; icon: string }
> = {
  hot: {
    label: "Hot",
    description: "High chance of closing — eyes on these",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    icon: "🔥",
  },
  warm: {
    label: "Warm",
    description: "Actively in motion — keep the heat",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-300",
    icon: "⚡",
  },
  cool: {
    label: "Cool",
    description: "Going cold — needs a nudge",
    color: "text-sky-700",
    bg: "bg-sky-50",
    border: "border-sky-300",
    icon: "❄",
  },
  cold: {
    label: "Cold",
    description: "Re-engage hard or archive",
    color: "text-slate-600",
    bg: "bg-slate-100",
    border: "border-slate-300",
    icon: "💤",
  },
};
