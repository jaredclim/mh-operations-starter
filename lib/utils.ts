import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Production capacity constants. A standard CC crew can absorb roughly
 * 25 billable hours per working day — so a 5-day work week is 125 hours
 * of capacity. These numbers drive how long jobs are scheduled to take
 * and how the timeline visualises week-by-week capacity.
 */
export const HOURS_PER_DAY = 25;
export const HOURS_PER_WEEK = 150; // 6 working days × 25 hrs (Mon–Sat)

/**
 * Approximate hours for a job. Estimated hours from the sheet are the
 * truth when present, but they're not always entered — especially for
 * jobs that came in mid-season or got booked on a phone call. In that
 * case we fall back to a $100/hr proxy on the booked value, which is
 * close enough for planning and matches how Jared eyeballs capacity.
 */
export function effectiveHours(job: { estHours: number | null; bookedValue: number }): number {
  if (job.estHours && job.estHours > 0) return job.estHours;
  if (job.bookedValue > 0) return Math.round((job.bookedValue / 100) * 10) / 10;
  return 0;
}

/**
 * How many weeks of crew capacity a job consumes. Used by the timeline
 * to decide how far to span a job rightward across week rows — so a
 * 200-hour job correctly shows up across two weeks instead of being
 * crammed into the start-week cell.
 */
export function weeksToFit(hours: number): number {
  if (hours <= 0) return 1;
  return Math.max(1, Math.ceil(hours / HOURS_PER_WEEK));
}

/**
 * How many working days a job needs at standard crew throughput. Useful
 * for tooltips and inline labels ("3-day job", "5-day job"). Returns at
 * least 1 day so even token jobs render visibly.
 */
export function daysToFit(hours: number): number {
  if (hours <= 0) return 1;
  return Math.max(1, Math.ceil(hours / HOURS_PER_DAY));
}

/**
 * Whether a date falls on a working day. CC crews work Mon–Sat by default
 * (Saturday is regular working day, not overtime). Sunday is off unless
 * the caller explicitly opts in (e.g., the Production Dashboard's
 * "Include Sundays" toggle). Every downstream calculation (capacity,
 * day-row layout, week totals) reads from here.
 */
export interface WorkingDayOpts {
  includeSunday?: boolean;
  /** When false, exclude Saturday (Mon–Fri only). Defaults to true since
   *  CC's standard week is Mon–Sat. */
  includeSaturday?: boolean;
}

export function isWorkingDay(d: Date, opts: WorkingDayOpts | boolean = false): boolean {
  // Backward-compat: a bare boolean second arg = includeSunday only.
  const includeSunday = typeof opts === "boolean" ? opts : opts.includeSunday ?? false;
  const includeSaturday = typeof opts === "boolean" ? true : opts.includeSaturday ?? true;
  const dow = d.getDay();
  if (dow === 0) return includeSunday;
  if (dow === 6) return includeSaturday;
  return dow >= 1 && dow <= 5;
}

/**
 * Walk forward `count` working days starting from `start` (advancing
 * past the weekend if `start` lands on Sat/Sun). Returns the list of
 * Date objects representing each working day the job will occupy.
 */
/**
 * Inclusive working-days between two dates (Mon–Sat). Treat the start
 * and end dates as the actual scheduled span — this is the truth Jared
 * sets in the sheet. Returns the list of working days the job covers.
 */
/**
 * Effective production status. The sheet's status column can hold the
 * legacy 5-state values (Scheduled / Power Washed / Colors Picked /
 * In Production / Complete) but we surface only 3 states: Scheduled,
 * In Production (auto-derived from today vs start/end dates), Complete.
 * The wash/colors dropdowns already track prep — duplicating them in
 * the status field added no signal.
 *
 * Rules:
 *   - status="Complete" → always Complete (manual override)
 *   - today within [startDate, endDate] → In Production
 *   - else → Scheduled
 */
export function effectiveStatus(job: {
  status: string;
  startDate: string | null;
  endDate: string | null;
}): "Scheduled" | "In Production" | "Complete" {
  if (job.status === "Complete") return "Complete";
  if (!job.startDate) return "Scheduled";
  const today = todayISO();
  const end = job.endDate || job.startDate;
  if (today >= job.startDate && today <= end) return "In Production";
  return "Scheduled";
}

export function workingDaysBetween(
  start: Date,
  end: Date,
  opts: WorkingDayOpts | boolean = false
): Date[] {
  const out: Date[] = [];
  const cur = new Date(start);
  cur.setHours(12, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(12, 0, 0, 0);
  while (cur <= stop) {
    if (isWorkingDay(cur, opts)) out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function workingDaysFrom(
  start: Date,
  count: number,
  opts: WorkingDayOpts | boolean = false
): Date[] {
  const out: Date[] = [];
  let cur = new Date(start);
  cur.setHours(12, 0, 0, 0);
  while (!isWorkingDay(cur, opts)) {
    cur.setDate(cur.getDate() + 1);
  }
  while (out.length < count) {
    if (isWorkingDay(cur, opts)) out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Same calendar day check, ignoring time. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatCurrencyShort(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function parseCurrency(raw: string): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseInteger(raw: string): number | null {
  if (!raw && raw !== "0") return null;
  const cleaned = String(raw).replace(/[^0-9-]/g, "");
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a decimal/float value (preserves the decimal point).
 * Use this for hours, percentages, etc. — anything that can be fractional.
 * parseInteger above STRIPS decimals (so "87.2" becomes 872), which is wrong
 * for hours.
 */
export function parseDecimal(raw: string): number | null {
  if (!raw && raw !== "0") return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Sheet may give "2026-05-12" or "5/12/2026" — normalize to YYYY-MM-DD
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

export function todayISO(): string {
  // America/Vancouver day boundary
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function relativeDate(targetISO: string, todayISO: string): string {
  const diff = daysBetween(todayISO, targetISO);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0 && diff <= 7) return `in ${diff}d`;
  if (diff < 0 && diff >= -30) return `${Math.abs(diff)}d overdue`;
  if (diff > 0) return `in ${diff}d`;
  return `${Math.abs(diff)}d ago`;
}
