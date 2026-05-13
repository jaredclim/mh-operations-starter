// Configurable sales goals. Edit these directly or override via env.
// VERIFIED 2026-05-09 — weekly is from Jared's GSR. Monthly is provisional
// (Jared said "might be" — verify and update when confirmed).

export const GOALS = {
  // Booking targets (in CAD, total contract value of jobs WON in the period)
  weeklyBookingsTarget: numEnv("WEEKLY_BOOKINGS_TARGET", 24_000),
  monthlyBookingsTarget: numEnv("MONTHLY_BOOKINGS_TARGET", 140_000),

  // Conversion targets (0-1)
  winRateTarget: numEnv("WIN_RATE_TARGET", 0.45),

  // Activity targets
  activeOpportunitiesFloor: numEnv("ACTIVE_OPP_FLOOR", 30),

  // What counts as "rotting" — days since last touch with no FU date set or in past
  rottingThresholdDays: numEnv("ROTTING_DAYS", 21),
} as const;

function numEnv(key: string, def: number): number {
  const raw = process.env[key];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}
