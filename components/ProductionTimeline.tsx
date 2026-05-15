"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Calendar, ChevronLeft, ChevronRight, AlertCircle, Maximize2, Minimize2, Pencil, Search, X, CalendarDays } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ProductionJobCard } from "./ProductionJobCard";
import { ProductionJobDrawer } from "./ProductionJobDrawer";
import { AddJobModal } from "./AddJobModal";
import {
  cn,
  daysToFit,
  effectiveHours,
  formatCurrency,
  HOURS_PER_DAY,
  HOURS_PER_WEEK,
  isSameDay,
  isWorkingDay,
  workingDaysBetween,
  workingDaysFrom,
} from "@/lib/utils";
import type { ProductionJob } from "@/lib/types";
import { commsState } from "@/lib/commsCadence";
import type { DayWeather } from "@/lib/weather";

interface Props {
  jobs: ProductionJob[];
  /** Server-fetched weather forecast keyed by YYYY-MM-DD. Optional —
   *  layout degrades gracefully when empty (e.g. API unreachable). */
  weather?: Record<string, DayWeather>;
  /** Initial manual crews (server-backed via Settings tab). */
  initialManualCrews?: string[];
  /** Initial crew availability blocks (server-backed). Keys are
   *  "<crew>::<dayISO>" → reason string. */
  initialBlocks?: Record<string, string>;
}

const UNASSIGNED_LABEL = "Unassigned";

// Day-row layout — matches Jared's existing Excel pattern and the pattern
// every trades dispatch board uses (ServiceTitan, Jobber, Housecall Pro).
// Each row = one working day (weekends skipped). Each column = one crew.
// Job cards span vertically across the days they occupy. Visual height =
// duration, which is the at-a-glance signal that makes the layout work.
const DAY_HEIGHT_PX = 60;
const CREW_COL_WIDTH = 240;

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const VANCOUVER_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function fmtISO(d: Date): string {
  const parts = VANCOUVER_DAY_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const dd = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${dd}`;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function fmtDayLabel(d: Date): { weekday: string; date: string; isMonthStart: boolean; isWeekStart: boolean } {
  return {
    weekday: WEEKDAY_NAMES[d.getDay()],
    date: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
    isMonthStart: d.getDate() === 1 || (d.getDay() === 1 && d.getDate() <= 7), // first Monday of month
    isWeekStart: d.getDay() === 1, // Monday
  };
}

export function ProductionTimeline({
  jobs: rawJobs,
  weather = {},
  initialManualCrews = [],
  initialBlocks = {},
}: Props) {
  // Hoisted to top of component so the optimistic-clear retry effect (below)
  // can use them. Other call sites previously redeclared these — that's now
  // dead code but harmless until a future cleanup pass.
  const topRouter = useRouter();
  const [, topStartTransition] = useTransition();
  // Optimistic overrides for in-flight drag-and-drop (and future inline
  // edits like resize). Drag-drop applies the move locally on drop so the
  // card snaps to its new position instantly — the server roundtrip
  // (sheets write + ISR revalidate) takes 1-3s and would otherwise feel
  // janky. When the server response arrives via router.refresh() and
  // rawJobs updates, we clear the overrides since the server is now the
  // source of truth.
  const [optimistic, setOptimistic] = useState<Map<string, Partial<ProductionJob>>>(new Map());
  const prevRawJobsRef = useRef(rawJobs);
  useEffect(() => {
    if (prevRawJobsRef.current === rawJobs) return;
    prevRawJobsRef.current = rawJobs;
    // BUGFIX (Jared 2026-05-15) — drag snap-back at ~10-20% rate. Previously
    // we cleared ALL optimistic state on any rawJobs change. But Google
    // Sheets is eventually-consistent: router.refresh() can fire BEFORE
    // the sheet propagates the new value, returning stale rawJobs.
    // Clearing optimistic then makes the card snap back to its old spot.
    // Fix: only clear an optimistic entry once the server's rawJobs row
    // ACTUALLY reflects the optimistic update. Stale-read entries persist
    // until the next refresh catches up.
    setOptimistic((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [jobId, override] of prev) {
        const serverJob = rawJobs.find((j) => j.jobId === jobId);
        if (!serverJob) continue;
        const matches =
          (override.startDate === undefined || serverJob.startDate === override.startDate) &&
          (override.endDate === undefined || serverJob.endDate === override.endDate) &&
          (override.crew === undefined || (serverJob.crew || "") === ((override.crew as string | undefined) ?? "")) &&
          (override.estHours === undefined || serverJob.estHours === override.estHours) &&
          (override.status === undefined || serverJob.status === override.status);
        if (matches) {
          next.delete(jobId);
        }
      }
      return next;
    });
  }, [rawJobs]);

  // Safety retry: if a router.refresh() returned stale data and the
  // optimistic state still has entries, fire another refresh ~2s later
  // to fetch the now-propagated sheet values. Only one retry per cycle.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (optimistic.size === 0) return;
    retryTimerRef.current = setTimeout(() => {
      topStartTransition(() => topRouter.refresh());
    }, 2000);
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [optimistic]);
  const jobs = useMemo(() => {
    if (optimistic.size === 0) return rawJobs;
    return rawJobs.map((j) => {
      const o = optimistic.get(j.jobId);
      return o ? { ...j, ...o } : j;
    });
  }, [rawJobs, optimistic]);

  // Window: 4 weeks of working days (24 days = Mon–Sat × 4) by default.
  // Show All renders every working day from earliest active year through
  // latest. Navigation steps by 1 week (6 working days).
  const WINDOW_DAYS = 24;
  const STEP_DAYS = 6;
  // Sunday inclusion — when ON, Sundays render in the grid as regular
  // working days. Default OFF (Jared's crews are Mon–Sat). Persisted in
  // localStorage so the toggle sticks across reloads.
  const [includeSunday, setIncludeSunday] = useState(false);
  const [includeSaturday, setIncludeSaturday] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("cc-prod-include-sunday") === "1") setIncludeSunday(true);
    if (localStorage.getItem("cc-prod-include-saturday") === "0") setIncludeSaturday(false);
  }, []);
  function toggleIncludeSunday() {
    setIncludeSunday((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("cc-prod-include-sunday", next ? "1" : "0");
      return next;
    });
  }
  function toggleIncludeSaturday() {
    setIncludeSaturday((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("cc-prod-include-saturday", next ? "1" : "0");
      return next;
    });
  }
  const wdOpts = useMemo(() => ({ includeSunday, includeSaturday }), [includeSunday, includeSaturday]);
  // View span: how many calendar months to render starting from the
  // anchor month. "all" renders the full active year(s).
  type ViewSpan = "1mo" | "2mo" | "3mo" | "all";
  const [viewSpan, setViewSpan] = useState<ViewSpan>("2mo");
  const showAll = viewSpan === "all";
  const monthsAhead = viewSpan === "1mo" ? 0 : viewSpan === "2mo" ? 1 : viewSpan === "3mo" ? 2 : 0;
  const [dayOffset, setDayOffset] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const monday = mondayOf(today);
    let target = new Date(today.getFullYear(), today.getMonth(), 1);
    target.setHours(12, 0, 0, 0);
    while (!isWorkingDay(target)) target.setDate(target.getDate() + 1);
    if (target.getTime() === monday.getTime()) return 0;
    let count = 0;
    const cur = new Date(monday);
    if (target > monday) {
      while (cur < target) {
        if (isWorkingDay(cur)) count++;
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      while (cur > target) {
        cur.setDate(cur.getDate() - 1);
        if (isWorkingDay(cur)) count--;
      }
    }
    return count;
  });

  const activeYears = useMemo(() => {
    const set = new Set<number>();
    set.add(new Date().getFullYear());
    for (const job of jobs) {
      if (job.startDate) set.add(Number(job.startDate.slice(0, 4)));
    }
    return [...set].sort();
  }, [jobs]);

  // Working-days list for the visible range. Weekends are dropped entirely
  // so each row in the grid is meaningful.
  const days = useMemo(() => {
    if (showAll) {
      const start = new Date(activeYears[0], 0, 1);
      const end = new Date(activeYears[activeYears.length - 1], 11, 31);
      const out: Date[] = [];
      let cur = new Date(start);
      cur.setHours(12, 0, 0, 0);
      while (cur <= end) {
        if (isWorkingDay(cur, wdOpts)) out.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const anchor = mondayOf(today);
    let cur = new Date(anchor);
    let remaining = dayOffset;
    while (remaining !== 0) {
      cur.setDate(cur.getDate() + (remaining > 0 ? 1 : -1));
      if (isWorkingDay(cur, wdOpts)) {
        remaining += remaining > 0 ? -1 : 1;
      }
    }
    const startDate = new Date(cur);
    const anchorMonth = startDate.getMonth();
    const anchorYear = startDate.getFullYear();
    // Extend the window to end of (anchor month + monthsAhead). For
    // "1mo" monthsAhead=0 → end of anchor month. For "3mo" monthsAhead=2
    // → end of (anchor + 2) months. Last working day of that calendar
    // month becomes the visible-window terminator.
    const monthEndDate = new Date(anchorYear, anchorMonth + 1 + monthsAhead, 0);
    monthEndDate.setHours(12, 0, 0, 0);
    while (!isWorkingDay(monthEndDate, wdOpts)) {
      monthEndDate.setDate(monthEndDate.getDate() - 1);
    }
    const out: Date[] = [];
    while (cur <= monthEndDate || out.length < WINDOW_DAYS) {
      if (isWorkingDay(cur, wdOpts)) out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
      if (out.length >= 70) break;
    }
    return out;
  }, [showAll, dayOffset, activeYears, wdOpts, monthsAhead]);

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  // Map of ISO day → index for quick job placement lookup
  const dayIndex = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((d, i) => map.set(fmtISO(d), i));
    return map;
  }, [days]);

  // Row-entry stream: full-width month banner whenever the calendar month
  // changes, thin week-separator strip on every Monday boundary, plus a
  // row per working day. The week-sep strip gives the eye a clear visual
  // break between weeks even when jobs are stacked back-to-back across
  // a week boundary — cards no longer bleed into each other.
  type RowEntry =
    | { kind: "month"; label: string; key: string }
    | { kind: "weekSep"; key: string }
    | { kind: "day"; day: Date; dayIdx: number };
  const rowEntries = useMemo<RowEntry[]>(() => {
    const out: RowEntry[] = [];
    let lastMonthKey = "";
    let lastWeekKey = "";
    days.forEach((day, dayIdx) => {
      const monthKey = `${day.getFullYear()}-${day.getMonth()}`;
      const weekKey = fmtISO(mondayOf(day));
      if (monthKey !== lastMonthKey) {
        out.push({
          kind: "month",
          label: day.toLocaleDateString("en-CA", { month: "long", year: "numeric" }),
          key: `month-${monthKey}`,
        });
        lastMonthKey = monthKey;
        lastWeekKey = weekKey; // month banner doubles as week sep — don't emit both
      } else if (weekKey !== lastWeekKey && dayIdx > 0) {
        // New work-week boundary (skip on very first day so we don't open
        // with a separator at the top of the view)
        out.push({ kind: "weekSep", key: `weeksep-${weekKey}` });
        lastWeekKey = weekKey;
      } else if (lastWeekKey === "") {
        lastWeekKey = weekKey;
      }
      out.push({ kind: "day", day, dayIdx });
    });
    return out;
  }, [days]);

  // dayIdx → 1-based gridRow (offset by 1 for column-header row at row 1).
  // Used by job-card placement to compute grid-row spans that correctly
  // bridge across month banners when a job crosses a month boundary.
  const dayIdxToGridRow = useMemo(() => {
    const map = new Map<number, number>();
    rowEntries.forEach((e, i) => {
      if (e.kind === "day") map.set(e.dayIdx, i + 2); // +1 col header, +1 1-based
    });
    return map;
  }, [rowEntries]);

  // Manual crews — locally-managed crew slots Jared adds via "+ Add crew".
  // Persisted in localStorage so the column sticks across reloads even
  // before any job is assigned to it. Once a real job lands in the crew,
  // the auto-derived list (from job.crew values) keeps it without needing
  // the manual entry.
  // Manual crews and crew availability blocks are now server-backed via
  // Settings!B14 (a single JSON cell). Multiple users share the same data,
  // so a PM marking Mike OFF for next week is visible to Jared (and vice
  // versa). Fire-and-forget PUT to /api/crews on every change.
  const [manualCrews, setManualCrews] = useState<string[]>(initialManualCrews);
  const [unavailable, setUnavailable] = useState<Record<string, string>>(initialBlocks);

  // Custom crew column order (per Jared 2026-05-12). When the user drags
  // a crew column header to a new position, that order persists to
  // localStorage and overrides the default frequency sort. Crews not in
  // the custom order list fall back to frequency sort and append after
  // the explicitly-ordered crews. Unassigned always stays at the end.
  // Per-user (localStorage) since "which crews matter most" is a
  // personal preference, not a shared team setting.
  const [customCrewOrder, setCustomCrewOrder] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cc-prod-crew-order");
      if (raw) setCustomCrewOrder(JSON.parse(raw));
    } catch {}
  }, []);
  function saveCustomCrewOrder(next: string[]) {
    setCustomCrewOrder(next);
    try {
      localStorage.setItem("cc-prod-crew-order", JSON.stringify(next));
    } catch {}
  }
  const [draggedCrew, setDraggedCrew] = useState<string | null>(null);
  const [dragOverCrew, setDragOverCrew] = useState<string | null>(null);

  // Deterministic "move column one slot" helper — used by the ◀/▶ buttons
  // on each crew header. More reliable than HTML5 drag on sticky positioned
  // elements (which sometimes silently fails on macOS Chrome/Safari).
  // Per Jared 2026-05-12: jobs auto-follow because columns are keyed by
  // crew name, not position. Reordering just changes visual order.
  function moveCrewBy(crewKey: string, delta: -1 | 1) {
    if (crewKey === UNASSIGNED_LABEL) return; // Unassigned stays pinned
    const currentOrder = crews.filter((c) => c !== UNASSIGNED_LABEL);
    const idx = currentOrder.indexOf(crewKey);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= currentOrder.length) return;
    const next = [...currentOrder];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    saveCustomCrewOrder(next);
  }

  async function syncCrewData(next: { manualCrews?: string[]; blocks?: Record<string, string> }) {
    try {
      const res = await fetch("/api/crews", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`server ${res.status}`);
    } catch (err) {
      console.error("crew data sync failed", err);
    }
  }

  function persistManualCrews(next: string[]) {
    setManualCrews(next);
    syncCrewData({ manualCrews: next, blocks: unavailable });
  }
  function persistUnavailable(next: Record<string, string>) {
    setUnavailable(next);
    syncCrewData({ manualCrews, blocks: next });
  }

  function isUnavailable(crewKey: string, dayISO: string): boolean {
    return Boolean(unavailable[`${crewKey}::${dayISO}`]);
  }
  function toggleUnavailable(crewKey: string, dayISO: string) {
    if (crewKey === UNASSIGNED_LABEL) return;
    const key = `${crewKey}::${dayISO}`;
    const next = { ...unavailable };
    if (next[key]) {
      delete next[key];
    } else {
      const reason = window.prompt(`Mark ${crewKey} OFF on ${dayISO}?\n\nReason (optional, e.g. "PTO", "Illness"):`, "Off");
      if (reason === null) return;
      next[key] = reason.trim() || "Off";
    }
    persistUnavailable(next);
  }

  // Drag-to-block range. User pointerdowns on OFF, drags down/up, releases.
  // Single click without drag = single-day toggle (handled by onClick on
  // the OFF button, NOT by the global pointerup). Movement is tracked
  // via the `hasDragged` flag — set true the moment hover crosses to a
  // different day. If hasDragged stays false, pointerup commits nothing
  // and the click handler does the single-day toggle.
  const [blockDrag, setBlockDrag] = useState<{
    crew: string;
    startDayISO: string;
    hoverDayISO: string;
    hasDragged: boolean;
  } | null>(null);
  function startBlockDrag(crew: string, dayISO: string) {
    if (crew === UNASSIGNED_LABEL) return;
    setBlockDrag({ crew, startDayISO: dayISO, hoverDayISO: dayISO, hasDragged: false });
  }
  function extendBlockDrag(crew: string, dayISO: string) {
    setBlockDrag((prev) => {
      if (!prev) return prev;
      if (prev.crew !== crew) return prev;
      const hasDragged = prev.hasDragged || dayISO !== prev.startDayISO;
      return { ...prev, hoverDayISO: dayISO, hasDragged };
    });
  }
  function commitBlockDrag() {
    if (!blockDrag) return;
    const { crew, startDayISO, hoverDayISO, hasDragged } = blockDrag;
    setBlockDrag(null);
    // No actual drag — leave the click handler to toggle the single day.
    if (!hasDragged) return;
    const a = new Date(startDayISO + "T12:00:00Z");
    const b = new Date(hoverDayISO + "T12:00:00Z");
    const [from, to] = a <= b ? [a, b] : [b, a];
    const rangeDays = workingDaysBetween(from, to, wdOpts);
    if (rangeDays.length === 0) return;
    const reason = window.prompt(
      `Mark ${crew} OFF for ${rangeDays.length} day${rangeDays.length === 1 ? "" : "s"} (${fmtISO(rangeDays[0])} → ${fmtISO(rangeDays[rangeDays.length - 1])})?\n\nReason:`,
      "Off"
    );
    if (reason === null) return;
    const next = { ...unavailable };
    const trimmed = reason.trim() || "Off";
    for (const d of rangeDays) {
      next[`${crew}::${fmtISO(d)}`] = trimmed;
    }
    persistUnavailable(next);
  }
  useEffect(() => {
    if (!blockDrag) return;
    function onUp() {
      commitBlockDrag();
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockDrag]);
  function addCrew() {
    const name = window.prompt("New crew name?");
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (manualCrews.includes(trimmed)) return;
    persistManualCrews([...manualCrews, trimmed]);
  }
  function removeCrew(name: string) {
    persistManualCrews(manualCrews.filter((c) => c !== name));
  }
  // Rename a crew across the entire schedule. Bulk-updates every job
  // whose crew column matches the old name. Confirmed before running so
  // the user knows how many jobs will be touched.
  async function renameCrew(oldName: string) {
    if (oldName === UNASSIGNED_LABEL) return;
    const jobCount = rawJobs.filter(
      (j) => (j.crew || "").trim().toLowerCase() === oldName.trim().toLowerCase()
    ).length;
    const newName = window.prompt(
      `Rename "${oldName}" to:` +
        (jobCount > 0
          ? `\n\nThis will update ${jobCount} active job${jobCount === 1 ? "" : "s"}.`
          : "\n\n(No active jobs — this is a manual / empty crew slot.)"),
      oldName
    );
    const trimmed = newName?.trim();
    if (!trimmed || trimmed === oldName) return;
    // Update local manual-crew list if the old name was there
    if (manualCrews.includes(oldName)) {
      persistManualCrews(manualCrews.map((c) => (c === oldName ? trimmed : c)));
    }
    // If old name appears on jobs, hit the server to bulk-rename
    if (jobCount > 0) {
      try {
        const res = await fetch("/api/production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "renameCrew", oldName, newName: trimmed }),
        });
        if (!res.ok) throw new Error(`server ${res.status}`);
        startTransition(() => router.refresh());
      } catch (err) {
        console.error("crew rename failed", err);
        window.alert(`Rename failed: ${(err as Error).message}`);
      }
    }
  }

  // Crews — preserve frequency-sorted ordering, merge manual crews,
  // always include Unassigned at end if any jobs are unscheduled.
  // When the user has manually reordered columns (customCrewOrder is
  // set), that order takes precedence: crews IN the custom list keep
  // their explicit positions, crews NOT in the custom list fall back
  // to frequency-sort and append after.
  const crews = useMemo(() => {
    const counts = new Map<string, number>();
    jobs.forEach((j) => {
      if (j.crew) counts.set(j.crew, (counts.get(j.crew) ?? 0) + 1);
    });
    // Merge in manual crews (zero count) — they appear at the end of the
    // active-crew block, before Unassigned.
    for (const c of manualCrews) {
      if (!counts.has(c)) counts.set(c, 0);
    }
    const allCrews = Array.from(counts.keys());

    let ordered: string[];
    if (customCrewOrder && customCrewOrder.length > 0) {
      // Apply user's custom order first, then append any crews not in
      // the custom list (newly created, freshly assigned) in frequency
      // order so they're still visible without manual intervention.
      const customSet = new Set(customCrewOrder);
      const inCustom = customCrewOrder.filter((c) => allCrews.includes(c));
      const notInCustom = allCrews
        .filter((c) => !customSet.has(c))
        .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
      ordered = [...inCustom, ...notInCustom];
    } else {
      ordered = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([crew]) => crew);
    }

    // Always include the Unassigned column at the END. It's the permanent
    // inbox for newly-Won jobs (no crew + no startDate). Custom ordering
    // never moves Unassigned — it stays terminal.
    return [...ordered.filter((c) => c !== UNASSIGNED_LABEL), UNASSIGNED_LABEL];
  }, [jobs, manualCrews, customCrewOrder]);

  // Per-crew totals (entire schedule, all jobs)
  const crewTotals = useMemo(() => {
    const totals: Record<string, { value: number; hours: number; count: number }> = {};
    for (const c of crews) totals[c] = { value: 0, hours: 0, count: 0 };
    for (const job of jobs) {
      const crewKey = job.crew || UNASSIGNED_LABEL;
      if (!totals[crewKey]) totals[crewKey] = { value: 0, hours: 0, count: 0 };
      totals[crewKey].value += job.bookedValue;
      totals[crewKey].hours += effectiveHours(job);
      totals[crewKey].count += 1;
    }
    return totals;
  }, [jobs, crews]);

  // Per-month totals — drives the chip strip + month jump nav. Revenue
  // is recognized on the END month (when produced), not the start month.
  // A job that starts May 30 and finishes June 5 credits June. Empty
  // months still render as $0 chips so gaps are visible while planning.
  const monthTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const job of jobs) {
      if (!job.startDate) continue;
      const days = jobWorkingDays(job);
      const endDate = days.length > 0 ? days[days.length - 1] : null;
      const ymRef = endDate
        ? `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`
        : job.startDate.slice(0, 7);
      totals[ymRef] = (totals[ymRef] || 0) + job.bookedValue;
    }
    for (const y of activeYears) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        if (totals[key] == null) totals[key] = 0;
      }
    }
    return totals;
  }, [jobs, activeYears]);

  // Active months for chip highlighting — multiple chips light up when
  // multiple months are in view. Rule: highlight the TOP N months by
  // visible-day count, where N matches the view span (1mo→1, 2mo→2,
  // 3mo→3). In show-all mode every month with any visible day lights up.
  // The "top N by count" rule prevents partial-edge months (e.g. April
  // 27-30 leading into a May 1mo view) from also being highlighted.
  const [anchorMonth, setAnchorMonth] = useState<string | null>(null);
  const activeMonthKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of days) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (showAll) {
      return new Set(counts.keys());
    }
    const targetCount = monthsAhead + 1; // 1mo=1, 2mo=2, 3mo=3
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, targetCount)
      .map(([k]) => k);
    return new Set(top);
  }, [showAll, days, monthsAhead]);

  // Refs for scroll-to-day in show-all mode
  const dayRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  function jumpToMonth(ym: string) {
    const [y, m] = ym.split("-").map(Number);
    if (showAll) {
      // Find first working day on/after the month's first
      const first = new Date(y, m - 1, 1);
      let cur = new Date(first);
      while (!isWorkingDay(cur, wdOpts)) cur.setDate(cur.getDate() + 1);
      const key = fmtISO(cur);
      const el = dayRefs.current.get(key);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      setAnchorMonth(ym);
      return;
    }
    // Window mode: set dayOffset so window starts on first working day of month
    const target = new Date(y, m - 1, 1);
    const today = mondayOf(new Date());
    today.setHours(12, 0, 0, 0);
    // Count working-days between today and target
    let cur = new Date(today);
    let count = 0;
    if (target >= today) {
      while (cur < target) {
        if (isWorkingDay(cur, wdOpts)) count++;
        cur.setDate(cur.getDate() + 1);
      }
      setDayOffset(count);
    } else {
      while (cur > target) {
        if (isWorkingDay(cur, wdOpts)) count--;
        cur.setDate(cur.getDate() - 1);
      }
      setDayOffset(count);
    }
  }

  const rangeLabel = useMemo(() => {
    if (showAll) return `Full year — ${days.length} working days`;
    const startStr = firstDay.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const endStr = lastDay.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  }, [showAll, days.length, firstDay, lastDay]);

  // Compute the working days a job actually occupies. endDate (when set)
  // is the truth — that's the scheduled span Jared committed to. If
  // endDate is missing, fall back to the hours-based estimate so jobs
  // booked without explicit dates still render somewhere reasonable.
  function jobWorkingDays(job: ProductionJob): Date[] {
    if (!job.startDate) return [];
    const start = new Date(job.startDate + "T12:00:00Z");
    if (job.endDate) {
      const end = new Date(job.endDate + "T12:00:00Z");
      if (end >= start) return workingDaysBetween(start, end, wdOpts);
    }
    const totalDays = daysToFit(effectiveHours(job));
    return workingDaysFrom(start, totalDays, wdOpts);
  }

  // Per-week totals for visible window. Keyed by Monday ISO. Used to show
  // dollar / hours produced per week in the Monday row's day-label cell —
  // critical for capacity tracking, this regressed when we switched to
  // day-row layout and is being restored.
  const weekTotals = useMemo(() => {
    const totals: Record<string, { value: number; hours: number; count: number }> = {};
    for (const d of days) {
      const monday = mondayOf(d);
      const key = fmtISO(monday);
      if (!totals[key]) totals[key] = { value: 0, hours: 0, count: 0 };
    }
    for (const job of jobs) {
      if (!job.startDate) continue;
      const jobDays = jobWorkingDays(job);
      if (jobDays.length === 0) continue;
      const totalDays = jobDays.length;
      const weekHits = new Map<string, number>();
      for (const d of jobDays) {
        const m = mondayOf(d);
        const k = fmtISO(m);
        weekHits.set(k, (weekHits.get(k) ?? 0) + 1);
      }
      // Revenue = "produced" = recognized on the END week. A job starting
      // Sat May 23 and finishing the next week credits the FOLLOWING
      // week's total, not May 18–23. Matches how Jared tracks weekly
      // production revenue.
      const endMondayKey = fmtISO(mondayOf(jobDays[jobDays.length - 1]));
      if (totals[endMondayKey]) {
        totals[endMondayKey].value += job.bookedValue;
        totals[endMondayKey].count += 1;
      }
      for (const [key, daysInWeek] of weekHits.entries()) {
        if (totals[key]) {
          totals[key].hours += (daysInWeek / Math.max(totalDays, 1)) * effectiveHours(job);
        }
      }
    }
    return totals;
  }, [days, jobs]);

  // Place each job onto the day grid: which row index it starts at, how
  // many day rows it spans within the visible window, and which crew column.
  type Placement = { job: ProductionJob; rowStart: number; rowSpan: number; crewIdx: number; isContinuation: boolean; isContinued: boolean };
  const placements = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    // Find a sensible "today" row index in the visible window. If today
    // isn't in the window (showing a future month), fall back to first day.
    const todayKeyLocal = fmtISO(new Date());
    const todayRowIdx = dayIndex.get(todayKeyLocal) ?? 0;

    // Track occupied (crewIdx, rowStart) cells so multiple unscheduled
    // jobs don't stack on top of each other in the Unassigned column.
    // Per Jared 2026-05-15 — first unscheduled job → today, next → next
    // working day, etc. Working-day skipping happens automatically because
    // the `days` array only contains working days.
    const occupiedUnscheduled = new Set<string>();

    for (const job of jobs) {
      // Unscheduled jobs (no startDate) land in their crew column (or
      // Unassigned) starting at today's row. If today is occupied, bump
      // to the next available working-day row below.
      //
      // Cards SIZE to their duration: dayCount = ceil(estHours / 25). So
      // a 100-hour job spans 4 rows, an 80-hour job spans ~3. Lets Jared
      // see at a glance how long each unscheduled job will take to schedule
      // around. Per Jared 2026-05-15. The next unscheduled job stacks
      // below the full span of the previous one.
      if (!job.startDate) {
        const crewIdx = crews.indexOf(job.crew || UNASSIGNED_LABEL);
        if (crewIdx === -1) continue;
        const dayCount = Math.max(1, daysToFit(effectiveHours(job)));
        let rowStart = todayRowIdx;
        while (
          rowStart < days.length &&
          occupiedUnscheduled.has(`${crewIdx}::${rowStart}`)
        ) {
          rowStart++;
        }
        // If we ran off the bottom of the visible window, fall back to
        // today's row (overlap is the lesser evil vs not rendering).
        if (rowStart >= days.length) rowStart = todayRowIdx;
        // Mark all rows the card will occupy so the next unscheduled job
        // stacks BELOW the full span, not on top of any of these rows.
        for (let r = rowStart; r < rowStart + dayCount && r < days.length; r++) {
          occupiedUnscheduled.add(`${crewIdx}::${r}`);
        }
        // Clamp the visual span to what fits in the window.
        const clampedSpan = Math.min(dayCount, days.length - rowStart);
        out.push({
          job,
          rowStart,
          rowSpan: Math.max(1, clampedSpan),
          crewIdx,
          isContinuation: false,
          isContinued: false,
        });
        continue;
      }
      const jobDays = jobWorkingDays(job);
      if (jobDays.length === 0) continue;
      // Which of the job's days fall in the visible window?
      const inWindow = jobDays
        .map((d, idx) => ({ idx, rowIdx: dayIndex.get(fmtISO(d)) ?? -1 }))
        .filter((x) => x.rowIdx !== -1);
      if (inWindow.length === 0) continue;
      const rowStart = Math.min(...inWindow.map((x) => x.rowIdx));
      const rowEnd = Math.max(...inWindow.map((x) => x.rowIdx));
      const firstJobIdx = inWindow[0].idx;
      const lastJobIdx = inWindow[inWindow.length - 1].idx;
      const crewKey = job.crew || UNASSIGNED_LABEL;
      const crewIdx = crews.indexOf(crewKey);
      if (crewIdx === -1) continue;
      out.push({
        job,
        rowStart,
        rowSpan: rowEnd - rowStart + 1,
        crewIdx,
        isContinuation: firstJobIdx > 0,
        isContinued: lastJobIdx < jobDays.length - 1,
      });
    }
    return out;
  }, [jobs, dayIndex, crews]);

  // Set of "crewKey::dayISO" strings for every day a job occupies.
  // Used to hide the "+" add-job affordance on DropCells that already
  // have a card — the button was bleeding through on top of cards.
  const occupiedCells = useMemo(() => {
    const set = new Set<string>();
    for (const p of placements) {
      for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r++) {
        const day = days[r];
        if (day) set.add(`${crews[p.crewIdx]}::${fmtISO(day)}`);
      }
    }
    return set;
  }, [placements, days, crews]);

  // Track open drawer by jobId so it stays in sync with optimistic / server
  // updates — opening as a snapshot value would freeze the drawer's view of
  // crewStatus, washStatus, etc. and crew-status active highlight wouldn't
  // update on click.
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const openJob = openJobId ? jobs.find((j) => j.jobId === openJobId) ?? null : null;

  // Search + filter state. Search matches job name (and address); filters
  // are togglable pills surfacing common planning questions: jobs that
  // need crew, colors, or wash. Used to dim non-matching cards rather
  // than removing them — keeps spatial context intact.
  const [searchQuery, setSearchQuery] = useState("");
  // Mobile-only: collapse secondary controls (Sat/Sun toggles, Add crew)
  // behind a "More" toggle to keep the header from being a wall of buttons.
  // On sm+ everything is always visible.
  const [showMobileExtras, setShowMobileExtras] = useState(false);
  // Click-to-add-job: when set, opens AddJobModal pre-filled with crew + start date.
  // Cleared when the modal closes. Per Jared 2026-05-12: click any empty cell
  // in a crew column to drop a new job directly there.
  const [prefillAddJob, setPrefillAddJob] = useState<{ crew: string; dayISO: string } | null>(null);
  // Mobile-only: collapse filter pills behind a "Filters" toggle.
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  type FilterKey = "needs-crew" | "needs-colors" | "needs-wash" | "incomplete" | "needs-touch";
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  function toggleFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function jobMatchesFilters(j: ProductionJob): boolean {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${j.name} ${j.address} ${j.crew} ${j.scope || ""} ${j.notes || ""} ${j.phone || ""} ${j.email || ""} ${j.jobId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (activeFilters.size === 0) return true;
    // "Needs crew" matches jobs that don't have a crew at all OR have one
    // but haven't been confirmed yet (Not Offered / Offered). Confirmed
    // jobs are filtered out — they're locked in.
    if (activeFilters.has("needs-crew")) {
      if (j.crew && j.crewStatus === "Confirmed") return false;
    }
    if (activeFilters.has("needs-colors") && j.colorsStatus === "Confirmed Colours") return false;
    if (activeFilters.has("needs-wash")) {
      const ok = j.washStatus === "Yes Scheduled" || j.washStatus === "Complete" || j.washStatus === "NA";
      if (ok) return false;
    }
    if (activeFilters.has("incomplete") && j.status === "Complete") return false;
    if (activeFilters.has("needs-touch")) {
      // "Needs touch" delegates to the SOP cadence engine — flags only
      // when the job is past its bucket's max gap or has an overdue
      // scheduled next-touch. See lib/commsCadence.ts.
      const state = commsState(j, fmtISO(new Date()));
      if (state.level !== "rose") return false;
    }
    return true;
  }

  const filteredJobsCount = useMemo(() => jobs.filter(jobMatchesFilters).length, [jobs, searchQuery, activeFilters]);
  const hasActiveSearchOrFilter = searchQuery.trim().length > 0 || activeFilters.size > 0;

  // Keyboard shortcuts: T = today, A = toggle Show all, ← / → = nav,
  // / = focus search, Esc = clear search/close drawer. Skipped when the
  // user is typing in any input/textarea/select to avoid stealing keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "Escape") {
        if (searchQuery) setSearchQuery("");
        return;
      }
      if (isTyping) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "t" || e.key === "T") {
        setViewSpan("1mo");
        setDayOffset(0);
        return;
      }
      if (e.key === "a" || e.key === "A") {
        setViewSpan((v) => (v === "all" ? "1mo" : "all"));
        setAnchorMonth(null);
        return;
      }
      if (!showAll && e.key === "ArrowLeft") {
        setDayOffset((d) => d - STEP_DAYS);
        return;
      }
      if (!showAll && e.key === "ArrowRight") {
        setDayOffset((d) => d + STEP_DAYS);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchQuery, showAll]);

  // Active search match — drives the auto-jump, the matched-card ring
  // highlight, and the inline hint under the search input. Null when
  // search is empty or no job matches.
  const [matchedJobId, setMatchedJobId] = useState<string | null>(null);
  const [searchHint, setSearchHint] = useState<string | null>(null);

  // Auto-jump to a matching job's month when search query changes. Without
  // this, typing a client name does nothing if the job lives outside the
  // current 1mo / 2mo / 3mo window — the match exists but stays off-screen.
  // Pick the match closest to today (future preferred, then most-recent
  // past) so the user lands near the most relevant occurrence.
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setMatchedJobId(null);
      setSearchHint(null);
      return;
    }
    const matches = jobs.filter((j) =>
      `${j.name} ${j.address} ${j.crew} ${j.scope || ""} ${j.notes || ""} ${j.phone || ""} ${j.email || ""} ${j.jobId}`
        .toLowerCase()
        .includes(q)
    );
    if (matches.length === 0) {
      setMatchedJobId(null);
      setSearchHint("No matching jobs");
      return;
    }
    const today = fmtISO(new Date());
    const dated = matches.filter((j) => j.startDate || j.endDate);
    if (dated.length === 0) {
      // Job exists in production but has no schedule date yet — can't
      // render on the timeline. Surface the names so Jared knows the
      // match was found.
      const names = matches.slice(0, 3).map((m) => m.name).join(", ");
      setMatchedJobId(matches[0].jobId);
      setSearchHint(
        `${matches.length} match${matches.length === 1 ? "" : "es"} (no schedule date set): ${names}${matches.length > 3 ? "…" : ""}`
      );
      return;
    }
    const target = dated
      .slice()
      .sort((a, b) => {
        const da = a.startDate || a.endDate || "";
        const db = b.startDate || b.endDate || "";
        const aFuture = da >= today;
        const bFuture = db >= today;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        return aFuture ? da.localeCompare(db) : db.localeCompare(da);
      })[0];
    setMatchedJobId(target.jobId);
    setSearchHint(
      matches.length > 1
        ? `${matches.length} matches — showing ${target.name}`
        : null
    );
    const dateStr = target.startDate || target.endDate!;
    const [y, m] = dateStr.split("-");
    const monthKey = `${y}-${m}`;
    if (!activeMonthKeys.has(monthKey)) {
      jumpToMonth(monthKey);
    }
    // jumpToMonth + activeMonthKeys deliberately omitted — re-running on
    // those would loop. searchQuery is the only user-driven trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, jobs]);

  // After the matched job's month is in view, scroll its specific day
  // into the top of the viewport so the highlighted card lands at the
  // top instead of mid-page. Re-runs when `days` updates (post-jump).
  useEffect(() => {
    if (!matchedJobId) return;
    const target = jobs.find((j) => j.jobId === matchedJobId);
    if (!target) return;
    const dateStr = target.startDate || target.endDate;
    if (!dateStr) return;
    const t = setTimeout(() => {
      const el = dayRefs.current.get(dateStr);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [matchedJobId, days, jobs]);

  // Drag-and-drop state. Active drag tracks which job is being dragged so
  // we can render a DragOverlay. Drop handler updates the job's startDate
  // and endDate (preserving duration) and reassigns crew on the server.
  const [activeDragJobId, setActiveDragJobId] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    // Desktop (mouse): instant drag after 5px movement — what users expect.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    // Mobile (touch): press-and-hold 250ms to start dragging. Without
    // this, scrolling vertically grabs the first card you touch — making
    // navigation impossible. 250ms is the standard "long-press" feel
    // used by Notion/Linear/Asana mobile.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );
  const activeDragJob = activeDragJobId ? jobs.find((j) => j.jobId === activeDragJobId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveDragJobId(String(e.active.id));
  }

  // Resize: drag the bottom edge of a card to extend/shrink duration in
  // working days. Live preview via optimistic state — the card grows /
  // shrinks as you drag. On release, commit the new endDate to the server.
  async function commitResize(jobId: string, newEndISO: string) {
    setOptimistic((prev) => {
      const next = new Map(prev);
      const existing = next.get(jobId) || {};
      next.set(jobId, { ...existing, endDate: newEndISO });
      return next;
    });
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action: "schedule", endDate: newEndISO }),
      });
      if (!res.ok) throw new Error(`server ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("resize failed", err);
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  function previewResize(jobId: string, newEndISO: string) {
    setOptimistic((prev) => {
      const next = new Map(prev);
      const existing = next.get(jobId) || {};
      next.set(jobId, { ...existing, endDate: newEndISO });
      return next;
    });
  }

  // Cycle crew commitment: Not Offered → Offered → Confirmed → Not Offered.
  // Triggered by clicking the small ○/→/✓ icon on the card so users can
  // toggle commitment without opening the drawer.
  //
  // SAFETY DEBOUNCE: optimistic UI updates instantly for each click, but
  // the SERVER commit is debounced 2.5s. If the user cycles through
  // states rapidly (○→→→✓→○ etc), only the FINAL state is committed.
  // Important because the iCal feed (which subs subscribe to) reads from
  // the server — an accidental momentary "Confirmed" while clicking
  // through would otherwise risk surfacing the job to the sub's calendar.
  // Combined with cal apps polling every 15-30 min, this debounce makes
  // accidental confirms effectively impossible to leak.
  const cycleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  function cycleCrewStatus(jobId: string) {
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    const order: Array<ProductionJob["crewStatus"]> = ["Not Offered", "Offered", "Confirmed"];
    const idx = order.indexOf(job.crewStatus);
    const next = order[(idx + 1) % order.length];
    // Optimistic update — UI shows the new state immediately for
    // visual feedback as the user clicks through.
    setOptimistic((prev) => {
      const m = new Map(prev);
      const existing = m.get(jobId) || {};
      m.set(jobId, { ...existing, crewStatus: next });
      return m;
    });
    // Cancel any pending commit for this job
    const existingTimer = cycleTimersRef.current.get(jobId);
    if (existingTimer) clearTimeout(existingTimer);
    // Schedule the actual server commit after a 2.5s pause
    const timer = setTimeout(async () => {
      cycleTimersRef.current.delete(jobId);
      // Re-read the current optimistic state at commit time (last click wins)
      const finalState = next; // closure captures the most recent next
      try {
        const res = await fetch("/api/production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, action: "crewStatus", crewStatus: finalState }),
        });
        if (!res.ok) throw new Error(`server ${res.status}`);
        startTransition(() => router.refresh());
      } catch (err) {
        console.error("crew status cycle commit failed", err);
        setOptimistic((prev) => {
          const m = new Map(prev);
          m.delete(jobId);
          return m;
        });
      }
    }, 2500);
    cycleTimersRef.current.set(jobId, timer);
  }

  // Undo toast — appears for 10s after each drag with a revert button.
  // Stores the pre-move state so we can roll back via the API + optimistic.
  // Bulk-select state. Shift-click any card to add to selection;
  // click without shift on a selected card deselects everything; the
  // action bar appears whenever selection is non-empty.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  function toggleSelect(jobId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  // Esc clears selection
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.size]);

  async function bulkApply(body: (jobId: string) => Record<string, unknown>) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // Fire all writes in parallel — Sheets API handles concurrent updates fine
    try {
      await Promise.all(
        ids.map((id) =>
          fetch("/api/production", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body(id)),
          })
        )
      );
      clearSelection();
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("bulk apply failed", err);
    }
  }

  async function bulkAssignCrew(newCrew: string) {
    await bulkApply((jobId) => ({
      jobId,
      action: "schedule",
      crew: newCrew === UNASSIGNED_LABEL ? "" : newCrew,
    }));
  }
  async function bulkSetCrewStatus(cs: "Not Offered" | "Offered" | "Confirmed") {
    await bulkApply((jobId) => ({ jobId, action: "crewStatus", crewStatus: cs }));
  }
  async function bulkMarkComplete() {
    await bulkApply((jobId) => ({ jobId, action: "status", status: "Complete" }));
  }

  const [undoToast, setUndoToast] = useState<{
    jobId: string;
    prevCrew: string;
    prevStartDate: string | null;
    prevEndDate: string | null;
    message: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showUndo(toast: NonNullable<typeof undoToast>) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast(toast);
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 10_000);
  }

  async function applyUndo() {
    if (!undoToast) return;
    const { jobId, prevCrew, prevStartDate, prevEndDate } = undoToast;
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setOptimistic((prev) => {
      const m = new Map(prev);
      const existing = m.get(jobId) || {};
      m.set(jobId, {
        ...existing,
        crew: prevCrew === UNASSIGNED_LABEL ? "" : prevCrew,
        startDate: prevStartDate,
        endDate: prevEndDate,
      });
      return m;
    });
    try {
      await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          action: "schedule",
          crew: prevCrew === UNASSIGNED_LABEL ? "" : prevCrew,
          startDate: prevStartDate ?? "",
          endDate: prevEndDate ?? "",
        }),
      });
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("undo failed", err);
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragJobId(null);
    const { active, over } = e;
    if (!over) return;
    const job = jobs.find((j) => j.jobId === String(active.id));
    if (!job) return;
    const overId = String(over.id);
    const [targetCrew, targetDayISO] = overId.split("::");
    if (!targetCrew || !targetDayISO) return;
    if ((job.crew || UNASSIGNED_LABEL) === targetCrew && job.startDate === targetDayISO) return;
    // Drop guard: warn if any of the days the job will occupy is marked
    // as crew-unavailable. Lets Jared override (sometimes you do schedule
    // anyway) but makes the conflict visible.
    const currentDays = jobWorkingDays(job).length || 1;
    const newStart = new Date(targetDayISO + "T12:00:00Z");
    const projectedDays = workingDaysFrom(newStart, currentDays, wdOpts);
    const conflicts = projectedDays
      .map((d) => fmtISO(d))
      .filter((iso) => unavailable[`${targetCrew}::${iso}`]);
    if (conflicts.length > 0) {
      const ok = window.confirm(
        `${targetCrew} is marked OFF on:\n${conflicts.join(", ")}\n\nSchedule anyway?`
      );
      if (!ok) return;
    }
    const newEnd = projectedDays.slice(-1)[0];
    const newEndISO = newEnd ? newEnd.toISOString().slice(0, 10) : undefined;
    const newCrew =
      targetCrew !== (job.crew || UNASSIGNED_LABEL)
        ? targetCrew === UNASSIGNED_LABEL
          ? ""
          : targetCrew
        : undefined;

    // Optimistic update — card moves instantly, no waiting for server
    setOptimistic((prev) => {
      const next = new Map(prev);
      next.set(job.jobId, {
        startDate: targetDayISO,
        endDate: newEndISO ?? job.endDate ?? null,
        ...(newCrew !== undefined ? { crew: newCrew } : {}),
      });
      return next;
    });

    const body: Record<string, unknown> = {
      jobId: job.jobId,
      action: "schedule",
      startDate: targetDayISO,
      endDate: newEndISO,
    };
    if (newCrew !== undefined) body.crew = newCrew;

    // Capture previous state for the undo toast BEFORE writing
    const prevCrew = job.crew || UNASSIGNED_LABEL;
    const prevStartDate = job.startDate;
    const prevEndDate = job.endDate;

    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`server ${res.status}`);
      startTransition(() => router.refresh());
      // Surface the undo affordance — 10s window to revert
      const fromLabel = prevCrew === UNASSIGNED_LABEL ? "Unassigned" : prevCrew;
      const toLabel = targetCrew === UNASSIGNED_LABEL ? "Unassigned" : targetCrew;
      showUndo({
        jobId: job.jobId,
        prevCrew,
        prevStartDate,
        prevEndDate,
        message:
          fromLabel === toLabel
            ? `Moved ${job.name} to ${targetDayISO}`
            : `Moved ${job.name} from ${fromLabel} to ${toLabel}`,
      });
    } catch (err) {
      console.error("drag-drop schedule update failed", err);
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.delete(job.jobId);
        return next;
      });
    }
  }

  const totalScheduledValue = useMemo(() => {
    return jobs.reduce((acc, j) => acc + j.bookedValue, 0);
  }, [jobs]);
  const unscheduledCount = jobs.filter((j) => !j.startDate || !j.crew).length;
  const todayKey = fmtISO(new Date());

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface rounded-2xl border border-border px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-4 h-4 text-cc-accent" />
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Total Scheduled
            </div>
            <div className="text-lg font-bold text-text-primary tabular-nums">
              {formatCurrency(totalScheduledValue)} · {jobs.length} jobs
            </div>
          </div>
          {unscheduledCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              <AlertCircle className="w-3 h-3" />
              {unscheduledCount} need scheduling
            </span>
          )}
          <AddJobModal jobs={jobs} crews={crews.filter((c) => c !== UNASSIGNED_LABEL)} />
          {/* Controlled instance for the empty-cell click-to-add affordance.
              No trigger button (hidden) — opens only when prefillAddJob is set
              from a cell click. */}
          <AddJobModal
            jobs={jobs}
            crews={crews.filter((c) => c !== UNASSIGNED_LABEL)}
            controlledOpen={prefillAddJob !== null}
            onOpenChange={(open) => { if (!open) setPrefillAddJob(null); }}
            initialCrew={prefillAddJob?.crew === UNASSIGNED_LABEL ? "" : prefillAddJob?.crew}
            initialStartDate={prefillAddJob?.dayISO}
            hideTriggerButton
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-text-secondary tabular-nums hidden sm:block">
            Viewing {rangeLabel}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* Mobile-only "More" toggle to keep header tidy on narrow screens */}
            <button
              onClick={() => setShowMobileExtras((v) => !v)}
              className="sm:hidden px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border bg-white hover:bg-zinc-50 inline-flex items-center gap-1"
              aria-label="More options"
              aria-expanded={showMobileExtras}
            >
              {showMobileExtras ? "− Less" : "+ More"}
            </button>
            <div className={cn("flex items-center gap-1 flex-wrap", !showMobileExtras && "hidden sm:flex")}>
              <button
                onClick={toggleIncludeSaturday}
              className={cn(
                "px-2 py-1.5 text-xs font-semibold rounded-md border transition-all inline-flex items-center gap-1",
                includeSaturday
                  ? "bg-cc-accent text-white border-cc-accent shadow-sm"
                  : "bg-white text-text-primary border-border hover:bg-zinc-50"
              )}
              title={includeSaturday ? "Hide Saturdays from grid" : "Include Saturdays in grid"}
            >
              {includeSaturday ? "✓ Sat" : "− Sat"}
            </button>
            <button
              onClick={toggleIncludeSunday}
              className={cn(
                "px-2 py-1.5 text-xs font-semibold rounded-md border transition-all inline-flex items-center gap-1",
                includeSunday
                  ? "bg-cc-accent text-white border-cc-accent shadow-sm"
                  : "bg-white text-text-primary border-border hover:bg-zinc-50"
              )}
              title={includeSunday ? "Hide Sundays from grid" : "Include Sundays in grid"}
            >
              {includeSunday ? "✓ Sun" : "+ Sun"}
            </button>
            <button
              onClick={addCrew}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-cc-accent/40 bg-cc-accent-soft text-cc-navy hover:bg-cc-accent/15 hover:border-cc-accent inline-flex items-center gap-1.5 transition-all"
              title="Add a new crew column"
            >
              <span className="text-base leading-none -mt-px">+</span>
              Add crew
            </button>
            </div>
            {/* Segmented view-span control: 1 / 2 / 3 months / All. */}
            <div className="inline-flex items-center rounded-md border border-border bg-white overflow-hidden">
              {([
                ["1mo", "1mo"],
                ["2mo", "2mo"],
                ["3mo", "3mo"],
                ["all", "All"],
              ] as Array<[ViewSpan, string]>).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setViewSpan(key);
                    if (key === "all") setAnchorMonth(null);
                  }}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-semibold transition-all border-r border-border last:border-r-0",
                    viewSpan === key
                      ? "bg-cc-accent text-white"
                      : "text-text-primary hover:bg-zinc-50"
                  )}
                  title={
                    key === "all"
                      ? "Show entire year scrollable"
                      : `Show ${key.replace("mo", " month")}${key === "1mo" ? "" : "s"}`
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {!showAll && (
              <>
                <button
                  onClick={() => setDayOffset((d) => d - STEP_DAYS)}
                  className="p-1.5 rounded-md border border-border bg-white hover:bg-zinc-50"
                  aria-label="Previous week"
                  title="Back 1 week"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDayOffset(0)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-border bg-white hover:bg-zinc-50"
                  title="Jump to current week"
                >
                  Today
                </button>
                <button
                  onClick={() => setDayOffset((d) => d + STEP_DAYS)}
                  className="p-1.5 rounded-md border border-border bg-white hover:bg-zinc-50"
                  aria-label="Next week"
                  title="Forward 1 week"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Search + filter bar — find jobs by name/address, filter by
          common planning questions ("needs colors / wash / crew"). Press
          / to focus the search input from anywhere on the page. */}
      <div className="bg-surface rounded-2xl border border-border px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search jobs (press /)"
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent/40 focus:border-cc-accent transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              title="Clear search (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {searchHint && (
          <div className="basis-full text-[11px] text-text-muted -mt-0.5">
            {searchHint}
          </div>
        )}
        <button
          onClick={() => setShowMobileFilters((v) => !v)}
          className={cn(
            "sm:hidden px-2.5 py-1.5 text-xs font-semibold rounded-md border inline-flex items-center gap-1.5 transition",
            activeFilters.size > 0
              ? "bg-cc-accent text-white border-cc-accent"
              : "bg-white border-border hover:bg-zinc-50"
          )}
          aria-expanded={showMobileFilters}
        >
          {activeFilters.size > 0 ? `Filters (${activeFilters.size})` : "Filters"}
        </button>
        <div className={cn("flex items-center gap-1.5 flex-wrap", !showMobileFilters && "hidden sm:flex")}>
          <FilterPill
            label="Needs crew"
            active={activeFilters.has("needs-crew")}
            onClick={() => toggleFilter("needs-crew")}
          />
          <FilterPill
            label="Needs colors"
            active={activeFilters.has("needs-colors")}
            onClick={() => toggleFilter("needs-colors")}
          />
          <FilterPill
            label="Needs wash"
            active={activeFilters.has("needs-wash")}
            onClick={() => toggleFilter("needs-wash")}
          />
          <FilterPill
            label="Needs touch"
            active={activeFilters.has("needs-touch")}
            onClick={() => toggleFilter("needs-touch")}
          />
          <FilterPill
            label="Active only"
            active={activeFilters.has("incomplete")}
            onClick={() => toggleFilter("incomplete")}
          />
        </div>
        {hasActiveSearchOrFilter && (
          <span className="text-xs text-text-muted ml-auto">
            <span className="font-bold text-text-primary tabular-nums">{filteredJobsCount}</span> of {jobs.length} jobs
          </span>
        )}
      </div>

      {/* Monthly chip strip — jump-to-month nav. */}
      {Object.keys(monthTotals).length > 0 && (
        <div className="flex items-center gap-2 bg-surface rounded-2xl border border-border px-4 py-3 overflow-x-auto whitespace-nowrap">
          <span className="text-xs uppercase tracking-wider text-text-muted font-bold mr-1 shrink-0 hidden sm:inline">
            Jump to:
          </span>
          {Object.entries(monthTotals)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ym, value]) => {
              const [y, m] = ym.split("-");
              const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-CA", {
                month: "short",
              });
              const active = activeMonthKeys.has(ym);
              const empty = value === 0;
              return (
                <button
                  key={ym}
                  onClick={() => jumpToMonth(ym)}
                  className={cn(
                    "inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm transition-all cursor-pointer shrink-0",
                    active
                      ? "bg-cc-accent text-white border border-cc-accent shadow-sm"
                      : empty
                        ? "bg-white border border-zinc-200 text-text-muted hover:border-zinc-400 hover:bg-zinc-50"
                        : "bg-cc-accent-soft border border-cc-accent/30 hover:border-cc-accent/60 hover:bg-cc-accent-soft/80"
                  )}
                  title={`Jump to ${monthName} ${y}`}
                >
                  <span className={cn("font-bold", active ? "text-white" : empty ? "text-text-muted" : "text-cc-navy")}>
                    {monthName}
                  </span>
                  <span className={cn("tabular-nums font-bold", active ? "text-white" : empty ? "text-text-muted/70" : "text-text-primary")}>
                    {formatCurrency(value)}
                  </span>
                </button>
              );
            })}
        </div>
      )}

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        /* Day-row grid. Sticky crew header at top. Show-all mode = scrollable
           container. Window mode = natural page scroll. */
        <div
          className={cn(
            // Grid is a clean white panel that floats on the warm page bg
            // (page bg shows in the margins). Cards lift off the white
            // cells via brand-tinted shadow + clear border, not via bg
            // contrast. This is the Stripe Dashboard / Linear pattern —
            // elevation through shadow, not background tinting.
            "bg-surface rounded-2xl border border-border overflow-x-auto",
            showAll && "max-h-[calc(100vh-280px)] overflow-y-auto"
          )}
        >
          <div
            className="grid relative"
            style={{
              // Sizing strategy (updated 2026-05-12 per Jared feedback):
              //  - Day label column: clamp(7rem, 11vw, 11rem)
              //  - EVERY crew column: fixed 240px (including Unassigned)
              //  - Grid width = sum of column widths (no "fill to 100%")
              //  - Wrapper has overflow-x-auto so 4-7 crews trigger smooth
              //    horizontal scroll without uneven column widths
              //
              // Previous bug: Unassigned + empty crews got "180px" while
              // crews with jobs got "minmax(220px, 1fr)". Different widths
              // + 1fr fighting with overflow caused the scroll to "stick"
              // partway through Unassigned. Fixed widths give predictable
              // scroll behavior at any crew count.
              //
              // minWidth still set so the grid never collapses below the
              // viewport on narrow screens — overflow-x-auto kicks in
              // whenever sum-of-columns > wrapper width.
              minWidth: `calc(11rem + ${crews.length} * ${CREW_COL_WIDTH}px)`,
              gridTemplateColumns: `clamp(7rem, 11vw, 11rem) ${crews
                .map(() => `${CREW_COL_WIDTH}px`)
                .join(" ")}`,
              gridTemplateRows: `auto ${rowEntries
                .map((e) =>
                  e.kind === "month"
                    ? "1.75rem"
                    : e.kind === "weekSep"
                      ? "0.5rem"
                      : `${DAY_HEIGHT_PX}px`
                )
                .join(" ")}`,
            }}
          >
            {/* Crew header — sticky */}
            <div
              className="sticky top-0 left-0 z-30 bg-surface border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-bold"
              style={{ gridRow: 1, gridColumn: 1 }}
            >
              Day
            </div>
            {crews.map((c, ci) => {
              const isManual = manualCrews.includes(c) && (!crewTotals[c] || crewTotals[c].count === 0);
              const isUnassigned = c === UNASSIGNED_LABEL;
              // Unassigned can't be reordered — it always stays at the end.
              // All other crews are drag-reorderable. Custom order persists
              // to localStorage per user.
              const isDraggableCrew = !isUnassigned;
              const isDragOverTarget = dragOverCrew === c && draggedCrew !== c;
              return (
                <div
                  key={c}
                  draggable={isDraggableCrew}
                  onDragStart={(e) => {
                    if (!isDraggableCrew) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c);
                    setDraggedCrew(c);
                  }}
                  onDragOver={(e) => {
                    if (!draggedCrew || isUnassigned || draggedCrew === c) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverCrew(c);
                  }}
                  onDragLeave={(e) => {
                    // Only clear when leaving the header entirely (relatedTarget outside)
                    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                      setDragOverCrew((cur) => (cur === c ? null : cur));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!draggedCrew || draggedCrew === c || isUnassigned) {
                      setDraggedCrew(null);
                      setDragOverCrew(null);
                      return;
                    }
                    // Compute new order: take current crews (minus Unassigned),
                    // remove dragged, insert at target's position.
                    const ordered = crews.filter((x) => x !== UNASSIGNED_LABEL);
                    const without = ordered.filter((x) => x !== draggedCrew);
                    const targetIdx = without.indexOf(c);
                    const next = [...without];
                    next.splice(targetIdx, 0, draggedCrew);
                    saveCustomCrewOrder(next);
                    setDraggedCrew(null);
                    setDragOverCrew(null);
                  }}
                  onDragEnd={() => {
                    setDraggedCrew(null);
                    setDragOverCrew(null);
                  }}
                  className={cn(
                    "sticky top-0 z-20 bg-surface border-b border-l border-border px-3 py-2 group/crewhead transition-all",
                    // Right border on the LAST column so the grid visually
                    // closes off (per Jared 2026-05-12 — without this the
                    // white space to the right of Unassigned looks unfinished).
                    ci === crews.length - 1 && "border-r",
                    isDraggableCrew && "cursor-grab active:cursor-grabbing",
                    draggedCrew === c && "opacity-50",
                    isDragOverTarget && "ring-2 ring-cc-accent ring-inset bg-cc-accent-soft/40"
                  )}
                  style={{ gridRow: 1, gridColumn: ci + 2 }}
                  title={isDraggableCrew ? `Drag to reorder ${c} (current position ${ci + 1})` : "Unassigned column stays at the end"}
                >
                  <div className="flex items-center gap-1">
                    {isDraggableCrew && (() => {
                      const orderedActive = crews.filter((x) => x !== UNASSIGNED_LABEL);
                      const idx = orderedActive.indexOf(c);
                      const canLeft = idx > 0;
                      const canRight = idx >= 0 && idx < orderedActive.length - 1;
                      return (
                        <span className="inline-flex items-center mr-0.5 opacity-0 group-hover/crewhead:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveCrewBy(c, -1); }}
                            disabled={!canLeft}
                            className="w-5 h-5 inline-flex items-center justify-center text-text-muted hover:text-cc-accent disabled:opacity-30 disabled:cursor-not-allowed text-[14px] leading-none"
                            title={`Move ${c} left`}
                            aria-label={`Move ${c} left`}
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveCrewBy(c, +1); }}
                            disabled={!canRight}
                            className="w-5 h-5 inline-flex items-center justify-center text-text-muted hover:text-cc-accent disabled:opacity-30 disabled:cursor-not-allowed text-[14px] leading-none"
                            title={`Move ${c} right`}
                            aria-label={`Move ${c} right`}
                          >
                            ▶
                          </button>
                          <span
                            className="text-text-muted/50 text-[10px] leading-none select-none ml-1"
                            aria-hidden
                            title="Or drag the header to reorder"
                          >
                            ⋮⋮
                          </span>
                        </span>
                      );
                    })()}
                    <span className="text-xs uppercase tracking-wider text-text-primary font-bold truncate">{c}</span>
                    {!isUnassigned && (
                      <>
                        <button
                          onClick={() => renameCrew(c)}
                          className="opacity-0 group-hover/crewhead:opacity-100 text-text-muted hover:text-cc-accent transition-opacity"
                          title="Rename this crew (updates all jobs assigned to it)"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/ical/token?crew=${encodeURIComponent(c)}`);
                              if (!res.ok) throw new Error(`server ${res.status}`);
                              const j = await res.json();
                              await navigator.clipboard.writeText(j.url);
                              window.alert(
                                `Calendar feed URL copied for ${c}.\n\n` +
                                  `What ${c} will see in their calendar:\n` +
                                  `• Only jobs with crew status = Confirmed (tentative placements stay private)\n` +
                                  `• Date span, address, scope, wash + colors status, client phone\n` +
                                  `• NOT internal notes or booked dollar value\n` +
                                  `• Full-day events — no time-of-day (they control their working hours)\n\n` +
                                  `Give them this URL to subscribe in Apple Calendar / Google Calendar / Outlook.\n\nURL:\n${j.url}`
                              );
                            } catch (err) {
                              window.alert(`Failed to get calendar URL: ${(err as Error).message}`);
                            }
                          }}
                          className="opacity-0 group-hover/crewhead:opacity-100 text-text-muted hover:text-cc-accent transition-opacity"
                          title={`Copy ${c}'s iCal subscription URL`}
                        >
                          <CalendarDays className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    {isManual && (
                      <button
                        onClick={() => removeCrew(c)}
                        className="ml-auto opacity-0 group-hover/crewhead:opacity-100 text-[10px] text-text-muted hover:text-rose-600 transition-opacity"
                        title="Remove this crew (only available for empty manual crews)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {crewTotals[c] && crewTotals[c].count > 0 && (
                    <div className="text-xs tabular-nums font-bold text-cc-navy mt-0.5 text-center">
                      {formatCurrency(crewTotals[c].value)}
                      {crewTotals[c].hours > 0 && (
                        <span className="text-text-muted font-semibold">
                          {" "}· {crewTotals[c].hours.toFixed(0)}h
                        </span>
                      )}
                    </div>
                  )}
                  {isManual && (
                    <div className="text-[9px] uppercase tracking-wider text-text-muted/70 font-semibold mt-0.5">
                      Empty
                    </div>
                  )}
                </div>
              );
            })}

            {/* Render row-entry stream: month banners as full-width strips,
                day rows as labeled cells + crew backgrounds. */}
            {rowEntries.map((entry, idx) => {
              const gridRow = idx + 2; // +1 col header, +1 1-based
              if (entry.kind === "month") {
                return (
                  <div
                    key={entry.key}
                    style={{ gridRow, gridColumn: `1 / -1` }}
                    className="bg-cc-navy/95 border-y border-cc-navy/20 px-4 flex items-center"
                  >
                    <span className="text-[10px] uppercase tracking-[0.15em] text-white font-bold">
                      {entry.label}
                    </span>
                  </div>
                );
              }
              if (entry.kind === "weekSep") {
                return (
                  <div
                    key={entry.key}
                    style={{ gridRow, gridColumn: `1 / -1` }}
                    className="bg-zinc-100 border-y border-zinc-200"
                  />
                );
              }
              const day = entry.day;
              const key = fmtISO(day);
              const label = fmtDayLabel(day);
              const isToday = key === todayKey;
              const isMonday = day.getDay() === 1;
              const mondayKey = fmtISO(mondayOf(day));
              const weekTotal = isMonday ? weekTotals[mondayKey] : undefined;
              const weekIdx = Math.floor(
                (mondayOf(day).getTime() - mondayOf(new Date(day.getFullYear(), 0, 1)).getTime()) / (7 * 86400000)
              );
              const isAltWeek = weekIdx % 2 === 1;
              return (
                <DayRow
                  key={key}
                  gridRow={gridRow}
                  day={day}
                  label={label}
                  isToday={isToday}
                  isMonday={isMonday}
                  isAltWeek={isAltWeek}
                  weekTotal={weekTotal}
                  crews={crews}
                  dayRef={(el) => {
                    dayRefs.current.set(key, el);
                  }}
                  unavailableMap={unavailable}
                  onToggleUnavailable={toggleUnavailable}
                  blockDrag={blockDrag}
                  onStartBlockDrag={startBlockDrag}
                  onExtendBlockDrag={extendBlockDrag}
                  onAddJobToCell={(crew, dayISO) => setPrefillAddJob({ crew, dayISO })}
                  occupiedCells={occupiedCells}
                  wdOpts={wdOpts}
                  weather={weather[key]}
                />
              );
            })}

            {/* Job cards — placed via grid-row span. Spans naturally bridge
                across any month banner rows that fall within the job.
                Each card is draggable; releasing over a different crew × day
                cell reschedules the job (preserving duration). */}
            {placements.map((p) => {
              const startGrid = dayIdxToGridRow.get(p.rowStart);
              const endGrid = dayIdxToGridRow.get(p.rowStart + p.rowSpan - 1);
              if (startGrid == null || endGrid == null) return null;
              const span = endGrid - startGrid + 1;
              return (
                <DraggableJob
                  key={p.job.jobId}
                  jobId={p.job.jobId}
                  startDate={p.job.startDate}
                  isActiveDrag={activeDragJobId === p.job.jobId}
                  gridRow={`${startGrid} / span ${span}`}
                  gridColumn={p.crewIdx + 2}
                  onResizePreview={previewResize}
                  onResizeCommit={commitResize}
                  wdOpts={wdOpts}
                >
                  <ProductionJobCard
                    job={p.job}
                    onClick={(e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
                      // Shift/Cmd/Ctrl + click toggles bulk selection;
                      // plain click opens the drawer as before.
                      if (e && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                        toggleSelect(p.job.jobId);
                      } else if (selectedIds.size > 0) {
                        // If selection is active, plain click clears it
                        clearSelection();
                      } else {
                        setOpenJobId(p.job.jobId);
                      }
                    }}
                    selected={selectedIds.has(p.job.jobId)}
                    height={p.rowSpan * DAY_HEIGHT_PX - 8}
                    isContinuation={p.isContinuation}
                    isContinued={p.isContinued}
                    dimmed={hasActiveSearchOrFilter && !jobMatchesFilters(p.job)}
                    searchMatched={p.job.jobId === matchedJobId}
                    onCycleCrewStatus={() => cycleCrewStatus(p.job.jobId)}
                    rainSeverity={(() => {
                      // Worst rain severity across all working days in
                      // this job's scheduled span. Heavy wins over light;
                      // light wins over none.
                      const jd = jobWorkingDays(p.job);
                      let worst: "none" | "light" | "heavy" = "none";
                      for (const d of jd) {
                        const sev = weather[fmtISO(d)]?.rainSeverity;
                        if (sev === "heavy") return "heavy";
                        if (sev === "light") worst = "light";
                      }
                      return worst;
                    })()}
                  />
                </DraggableJob>
              );
            })}
          </div>
        </div>
      )}

      {openJob && (
        <ProductionJobDrawer
          job={openJob}
          open={!!openJob}
          onClose={() => setOpenJobId(null)}
          crews={crews.filter((c) => c !== UNASSIGNED_LABEL)}
        />
      )}
    </div>
    {/* Bulk-select action bar — sticky-floating below the page header.
        Refined visual treatment: backdrop blur, subtle ring, smooth
        entrance animation, refined typography hierarchy, color-coded
        action groups (assign = neutral; offer = amber; confirm/complete
        = emerald). */}
    <AnimatePresence>
      {selectedIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed top-[5rem] left-1/2 -translate-x-1/2 z-[65] w-fit max-w-[calc(100vw-1.5rem)]"
        >
          <div className="bg-cc-navy/95 backdrop-blur-md text-white rounded-xl shadow-[0_12px_36px_-8px_rgba(15,45,74,0.55)] ring-1 ring-white/10 overflow-x-auto">
            <div className="flex items-center gap-2 px-3 py-2 whitespace-nowrap">
              {/* Selection count chip */}
              <span className="inline-flex items-center gap-1.5 bg-cc-accent text-cc-navy text-xs font-extrabold tabular-nums px-2.5 py-1 rounded-md shadow-sm">
                <span className="text-sm leading-none">●</span>
                {selectedIds.size}
                <span className="font-semibold opacity-80">selected</span>
              </span>

              {/* Divider */}
              <div className="h-5 w-px bg-white/15 mx-0.5" />

              {/* Assign group */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-white/55 font-bold mr-0.5">
                  Assign
                </span>
                {crews
                  .filter((c) => c !== UNASSIGNED_LABEL)
                  .map((c) => (
                    <button
                      key={c}
                      onClick={() => bulkAssignCrew(c)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                <button
                  onClick={() => bulkAssignCrew(UNASSIGNED_LABEL)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
                  title="Move to Unassigned column"
                >
                  Unassign
                </button>
              </div>

              <div className="h-5 w-px bg-white/15 mx-0.5" />

              {/* Status group */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-white/55 font-bold mr-0.5">
                  Status
                </span>
                <button
                  onClick={() => bulkSetCrewStatus("Offered")}
                  className="px-2.5 py-1 text-xs font-bold rounded-md bg-amber-500/90 hover:bg-amber-500 active:bg-amber-600 text-white transition-colors shadow-sm"
                >
                  → Offered
                </button>
                <button
                  onClick={() => bulkSetCrewStatus("Confirmed")}
                  className="px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-500/90 hover:bg-emerald-500 active:bg-emerald-600 text-white transition-colors shadow-sm"
                >
                  ✓ Confirmed
                </button>
                <button
                  onClick={bulkMarkComplete}
                  className="px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-700/90 hover:bg-emerald-700 active:bg-emerald-800 text-white transition-colors shadow-sm"
                >
                  Mark Complete
                </button>
              </div>

              <div className="h-5 w-px bg-white/15 mx-0.5" />

              {/* Dismiss */}
              <button
                onClick={clearSelection}
                className="text-white/70 hover:text-white text-base leading-none w-6 h-6 rounded-md hover:bg-white/10 inline-flex items-center justify-center transition-colors"
                aria-label="Clear selection (Esc)"
                title="Clear selection (Esc)"
              >
                ×
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Undo toast — bottom-center, auto-dismisses after 10s. Matches
        the bulk-bar visual treatment for consistency. */}
    <AnimatePresence>
      {undoToast && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-[calc(100vw-1.5rem)]"
        >
          <div className="bg-cc-navy/95 backdrop-blur-md text-white rounded-xl shadow-[0_12px_36px_-8px_rgba(15,45,74,0.55)] ring-1 ring-white/10 px-4 py-2.5 flex items-center gap-3 text-sm">
            <span className="font-medium">{undoToast.message}</span>
            <button
              onClick={applyUndo}
              className="px-2.5 py-1 text-xs font-bold rounded-md bg-cc-accent text-cc-navy hover:bg-cc-accent/90 active:bg-cc-accent/80 transition-colors shadow-sm"
            >
              Undo
            </button>
            <button
              onClick={() => setUndoToast(null)}
              className="text-white/70 hover:text-white text-base leading-none w-6 h-6 rounded-md hover:bg-white/10 inline-flex items-center justify-center transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* Drag overlay — renders the picked-up card following the cursor */}
    <DragOverlay>
      {activeDragJob ? (
        <div className="opacity-90 rotate-1 shadow-2xl">
          <ProductionJobCard job={activeDragJob} onClick={() => {}} height={56} />
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

function DayRow({
  gridRow,
  day,
  label,
  isToday,
  isMonday,
  isAltWeek,
  weekTotal,
  crews,
  dayRef,
  unavailableMap,
  onToggleUnavailable,
  blockDrag,
  onStartBlockDrag,
  onExtendBlockDrag,
  onAddJobToCell,
  occupiedCells,
  wdOpts,
  weather,
}: {
  gridRow: number;
  day: Date;
  label: { weekday: string; date: string; isMonthStart: boolean; isWeekStart: boolean };
  isToday: boolean;
  isMonday: boolean;
  isAltWeek: boolean;
  weekTotal?: { value: number; hours: number; count: number };
  crews: string[];
  dayRef: (el: HTMLDivElement | null) => void;
  unavailableMap: Record<string, string>;
  onToggleUnavailable: (crewKey: string, dayISO: string) => void;
  blockDrag: { crew: string; startDayISO: string; hoverDayISO: string } | null;
  onStartBlockDrag: (crew: string, dayISO: string) => void;
  onExtendBlockDrag: (crew: string, dayISO: string) => void;
  onAddJobToCell: (crew: string, dayISO: string) => void;
  occupiedCells: Set<string>;
  wdOpts: { includeSunday: boolean; includeSaturday: boolean };
  weather?: DayWeather;
}) {
  const bgTint = isToday
    ? "bg-cc-accent-soft/60"
    : isAltWeek
      ? "bg-zinc-50/40"
      : "";
  const crewBgTint = isToday
    ? "bg-cc-accent-soft/30"
    : isAltWeek
      ? "bg-zinc-50/40"
      : "";
  return (
    <>
      <div
        ref={dayRef}
        className={cn(
          "px-2 sm:px-3 border-b border-border flex items-center gap-1 sm:gap-1.5 relative transition-colors flex-wrap",
          // Sticky-left so the date stays visible when scrolling the crew
          // columns horizontally on mobile. White-ish bg ensures it
          // doesn't bleed through.
          "sticky left-0 z-[5] bg-surface",
          bgTint,
          isToday && "border-l-[3px] border-l-cc-accent"
        )}
        style={{ gridRow, gridColumn: 1 }}
      >
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider w-7 shrink-0",
            isToday ? "text-cc-accent" : "text-text-muted"
          )}
        >
          {label.weekday}
        </span>
        <span className={cn("text-[12px] font-bold tabular-nums shrink-0", isToday ? "text-cc-accent" : "text-text-primary")}>
          {label.date}
        </span>
        {isToday && (
          <span className="text-[8px] uppercase tracking-wider text-cc-accent font-bold ml-1">
            Today
          </span>
        )}
        {/* Weather chip — icon + temp + rain-severity tint. Color encodes
            severity: rose = heavy, amber = light drizzle, muted = dry. */}
        {weather && Number.isFinite(weather.tempMaxC) && (
          <span
            className={cn(
              "ml-1 inline-flex items-center gap-0.5 text-[10px] tabular-nums",
              weather.rainSeverity === "heavy"
                ? "text-rose-600 font-bold"
                : weather.rainSeverity === "light"
                  ? "text-amber-600 font-semibold"
                  : "text-text-muted"
            )}
            title={`${weather.label} · ${weather.tempMinC.toFixed(0)}–${weather.tempMaxC.toFixed(0)}°C · ${weather.precipMm.toFixed(1)}mm precip`}
          >
            <span>{weather.icon}</span>
            <span>{weather.tempMaxC.toFixed(0)}°</span>
            {weather.rainSeverity === "heavy" && <span className="ml-0.5">⚠</span>}
          </span>
        )}
        {isMonday && weekTotal && weekTotal.value > 0 && (
          <span className="basis-full text-left tabular-nums text-[11.5px] font-bold leading-none mt-1.5">
            <span className="text-cc-navy">{formatCurrency(weekTotal.value)}</span>
            <span className="text-text-muted font-semibold ml-1 text-[10.5px]">· {weekTotal.hours.toFixed(0)}h</span>
          </span>
        )}
      </div>
      {crews.map((c, ci) => {
        const dayISO = fmtISO(day);
        const inPendingBlock =
          blockDrag != null &&
          blockDrag.crew === c &&
          isDateInRange(dayISO, blockDrag.startDayISO, blockDrag.hoverDayISO);
        return (
          <DropCell
            key={c}
            crewKey={c}
            dayISO={dayISO}
            gridRow={gridRow}
            gridColumn={ci + 2}
            tint={crewBgTint}
            unavailableReason={unavailableMap[`${c}::${dayISO}`]}
            onToggleUnavailable={onToggleUnavailable}
            inPendingBlock={inPendingBlock}
            onStartBlockDrag={onStartBlockDrag}
            onExtendBlockDrag={onExtendBlockDrag}
            isBlockDragging={blockDrag != null}
            onAddJob={onAddJobToCell}
            hasJob={occupiedCells.has(`${c}::${dayISO}`)}
            isLastColumn={ci === crews.length - 1}
          />
        );
      })}
    </>
  );
}

function DraggableJob({
  jobId,
  startDate,
  isActiveDrag,
  gridRow,
  gridColumn,
  children,
  onResizePreview,
  onResizeCommit,
  wdOpts,
}: {
  jobId: string;
  startDate: string | null;
  isActiveDrag: boolean;
  gridRow: string;
  gridColumn: number;
  children: React.ReactNode;
  onResizePreview: (jobId: string, newEndISO: string) => void;
  onResizeCommit: (jobId: string, newEndISO: string) => void;
  wdOpts: { includeSunday: boolean; includeSaturday: boolean };
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: jobId });
  return (
    <div
      ref={setNodeRef}
      style={{ gridRow, gridColumn }}
      className={cn(
        "p-1 relative z-[1] group/draggable",
        (isDragging || isActiveDrag) && "opacity-30"
      )}
    >
      {/* Drag area = the card body. Listeners attached only here so the
          resize handle below can claim its own pointer events without
          fighting dnd-kit. */}
      <div
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing h-full"
      >
        {children}
      </div>
      {startDate && (
        <ResizeHandle
          jobId={jobId}
          startDate={startDate}
          onPreview={onResizePreview}
          onCommit={onResizeCommit}
          wdOpts={wdOpts}
        />
      )}
    </div>
  );
}

const RESIZE_DAY_HEIGHT_PX = 60; // matches DAY_HEIGHT_PX

function ResizeHandle({
  jobId,
  startDate,
  onPreview,
  onCommit,
  wdOpts,
}: {
  jobId: string;
  startDate: string;
  onPreview: (jobId: string, newEndISO: string) => void;
  onCommit: (jobId: string, newEndISO: string) => void;
  wdOpts: { includeSunday: boolean; includeSaturday: boolean };
}) {
  const startYRef = useRef<number | null>(null);
  const lastEndISORef = useRef<string | null>(null);

  function computeNewEnd(deltaY: number): string | null {
    // Convert Y-pixel delta to working-day count (round to nearest day),
    // clamp to ≥1 day, then walk forward from startDate.
    const deltaDays = Math.round(deltaY / RESIZE_DAY_HEIGHT_PX);
    const newDays = Math.max(1, 1 + deltaDays); // pointerdown anchored at end-of-current; using offset from there
    const start = new Date(startDate + "T12:00:00Z");
    const days = workingDaysFrom(start, newDays, wdOpts);
    const last = days[days.length - 1];
    return last ? last.toISOString().slice(0, 10) : null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (startYRef.current == null) return;
    e.stopPropagation();
    // Read current days from the rendered card height — handle is at the
    // bottom of the card; pointer Y relative to the card top tells us the
    // intended duration in days.
    const handle = e.currentTarget as HTMLElement;
    const wrapper = handle.parentElement;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const yInWrapper = e.clientY - rect.top;
    // Remove the wrapper padding (p-1 = 4px on top)
    const dayCount = Math.max(1, Math.round((yInWrapper - 4) / RESIZE_DAY_HEIGHT_PX));
    const start = new Date(startDate + "T12:00:00Z");
    const days = workingDaysFrom(start, dayCount);
    const last = days[days.length - 1];
    if (!last) return;
    const newEndISO = last.toISOString().slice(0, 10);
    if (newEndISO !== lastEndISORef.current) {
      lastEndISORef.current = newEndISO;
      onPreview(jobId, newEndISO);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (startYRef.current == null) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    startYRef.current = null;
    if (lastEndISORef.current) {
      onCommit(jobId, lastEndISORef.current);
      lastEndISORef.current = null;
    }
  }

  // Suppress unused warning for computeNewEnd — kept for reference doc.
  void computeNewEnd;

  return (
    <div
      role="separator"
      aria-label="Resize duration"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute left-1 right-1 bottom-0 h-2 z-[2]",
        "cursor-ns-resize touch-none",
        "opacity-0 group-hover/draggable:opacity-100 transition-opacity",
        "after:content-[''] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0.5 after:w-8 after:h-1 after:rounded-full after:bg-cc-accent/70"
      )}
    />
  );
}

function DropCell({
  crewKey,
  dayISO,
  gridRow,
  gridColumn,
  tint,
  unavailableReason,
  onToggleUnavailable,
  inPendingBlock,
  onStartBlockDrag,
  onExtendBlockDrag,
  isBlockDragging,
  onAddJob,
  hasJob,
  isLastColumn,
}: {
  crewKey: string;
  dayISO: string;
  gridRow: number;
  gridColumn: number;
  tint: string;
  unavailableReason?: string;
  onToggleUnavailable: (crewKey: string, dayISO: string) => void;
  inPendingBlock: boolean;
  onStartBlockDrag: (crewKey: string, dayISO: string) => void;
  onExtendBlockDrag: (crewKey: string, dayISO: string) => void;
  isBlockDragging: boolean;
  onAddJob: (crewKey: string, dayISO: string) => void;
  hasJob?: boolean;
  isLastColumn: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${crewKey}::${dayISO}` });
  const isOff = Boolean(unavailableReason);
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        if (e.shiftKey) {
          e.preventDefault();
          onToggleUnavailable(crewKey, dayISO);
        }
      }}
      onPointerEnter={() => {
        if (isBlockDragging) onExtendBlockDrag(crewKey, dayISO);
      }}
      className={cn(
        "border-b border-l border-border transition-all duration-150 ease-out relative group/cell",
        // Right border on the last column so the grid closes off visually
        isLastColumn && "border-r",
        tint,
        isOver && !isOff && "bg-emerald-100/70 ring-2 ring-emerald-400 ring-inset",
        isOver && isOff && "bg-rose-100/70 ring-2 ring-rose-400 ring-inset",
        !isOver && !isOff && "hover:bg-cc-accent-soft/30",
        isOff && "bg-zinc-100",
        // Pending-block highlight — cells the user is currently dragging
        // across to mark OFF in one shot. Subtle amber so it reads as
        // "preview, not committed yet".
        inPendingBlock && "bg-amber-100/60 ring-2 ring-amber-400 ring-inset",
      )}
      style={{
        gridRow,
        gridColumn,
        ...(isOff
          ? {
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(115,115,125,0.15) 0, rgba(115,115,125,0.15) 4px, transparent 4px, transparent 10px)",
            }
          : {}),
      }}
    >
      {isOff && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-white/70 px-1.5 py-0.5 rounded"
            title={unavailableReason}
          >
            {unavailableReason && unavailableReason.length <= 8 ? unavailableReason : "Off"}
          </span>
        </div>
      )}
      {crewKey !== UNASSIGNED_LABEL && (
        <button
          type="button"
          onPointerDown={(e) => {
            // Start a block-drag on pointer-down. Single-click vs drag is
            // disambiguated by pointer movement — release without moving
            // = single-cell toggle (existing onClick); release after
            // moving across cells = range block.
            e.stopPropagation();
            if (!isOff) {
              onStartBlockDrag(crewKey, dayISO);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            // Click always toggles a single day. The global pointerup
            // commit only fires for actual drags (hasDragged=true), so
            // there's no conflict between click and drag-commit paths.
            onToggleUnavailable(crewKey, dayISO);
          }}
          className={cn(
            "absolute top-0.5 right-0.5 z-[2] text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded transition-opacity",
            "opacity-0 group-hover/cell:opacity-100",
            isOff
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
          )}
          title={
            isOff
              ? `Unblock ${crewKey} on ${dayISO}`
              : `Mark ${crewKey} OFF on ${dayISO} (drag to mark a range)`
          }
        >
          {isOff ? "✓ ON" : "OFF"}
        </button>
      )}
      {/* "+" affordance — click empty cell to add a job pre-filled with
          THIS crew + day. Hover-revealed in top-left so it doesn't
          collide with the OFF button (top-right). Hidden when cell is
          OFF (can't add a job to a blocked day), in Unassigned column,
          OR when a job already occupies this cell (hasJob=true) —
          prevents the button from appearing on top of existing cards
          and blocking the crew-status icon. */}
      {!isOff && !hasJob && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onAddJob(crewKey, dayISO);
          }}
          className={cn(
            "absolute top-0.5 left-0.5 z-[2] w-5 h-5 flex items-center justify-center rounded text-[14px] font-bold transition-opacity",
            "opacity-0 group-hover/cell:opacity-100",
            "bg-cc-navy text-white hover:bg-cc-navy-deep"
          )}
          title={
            crewKey === UNASSIGNED_LABEL
              ? `Add new job (start ${dayISO}, unassigned)`
              : `Add new job to ${crewKey} starting ${dayISO}`
          }
        >
          +
        </button>
      )}
    </div>
  );
}

/** ISO compare — is `target` between `a` and `b` inclusive (either order)? */
function isDateInRange(target: string, a: string, b: string): boolean {
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  return target >= lo && target <= hi;
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 text-xs font-semibold rounded-full border transition-all duration-150 ease-out",
        active
          ? "bg-cc-accent text-white border-cc-accent shadow-sm"
          : "bg-white text-text-secondary border-border hover:border-cc-accent/50 hover:text-text-primary"
      )}
    >
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface rounded-2xl border border-border p-12 text-center">
      <Calendar className="w-8 h-8 text-text-muted mx-auto mb-3" />
      <h3 className="text-base font-semibold text-text-primary mb-1">No jobs in production yet</h3>
      <p className="text-sm text-text-secondary max-w-md mx-auto">
        When you Mark a lead as Won via the Pipeline tab, the job will automatically appear here for scheduling.
        Click any job card to assign a crew, set start/end dates, update status, or log notes.
      </p>
    </div>
  );
}
