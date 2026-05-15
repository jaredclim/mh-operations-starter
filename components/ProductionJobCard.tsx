"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn, daysToFit, effectiveHours, effectiveStatus, formatCurrency, todayISO, workingDaysBetween } from "@/lib/utils";
import type { ColorsStatus, ProductionJob, WashStatus } from "@/lib/types";
import { commsState as commsStateLib } from "@/lib/commsCadence";

interface Props {
  job: ProductionJob;
  /** Called on click — receives the click event so the parent can detect
   *  modifier keys (shift/cmd/ctrl) for multi-select. */
  onClick: (e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  /** True when this card is part of the active multi-select. */
  selected?: boolean;
  /** Card height in px — drives content density. Day-row layout sets this
   *  based on duration: 1-day cards are short, 5-day cards are tall. */
  height?: number;
  /** Job started in a prior visible-window period — flag with a top "(cont.)" label. */
  isContinuation?: boolean;
  /** Job continues into a later period — bottom "(cont.)" label. */
  isContinued?: boolean;
  /** Dim card when search/filter excludes it — keeps spatial layout intact
   *  while making matches stand out. */
  dimmed?: boolean;
  /** Highlight this card when it's the active search match. Distinct
   *  ring colour from `selected` so the two affordances don't collide. */
  searchMatched?: boolean;
  /** Cycle crew commitment status (Not Offered → Offered → Confirmed →
   *  Not Offered) when the small ○/→/✓ icon is clicked. */
  onCycleCrewStatus?: () => void;
  /** Worst-rain-severity day in this job's scheduled span. Drives a
   *  colored 🌧 indicator on the card so exterior jobs at risk of
   *  weather disruption are visible at a glance. "heavy" = day-stopping,
   *  "light" = disruptive drizzle/showers. */
  rainSeverity?: "none" | "light" | "heavy";
}

const MOV_EDGE: Record<string, string> = {
  Flexible: "before:bg-emerald-500",
  Window: "before:bg-purple-500",
  Immovable: "before:bg-rose-500",
};
const COMPLETE_EDGE = "before:bg-zinc-700";

// Effective status (3-state model — see effectiveStatus in lib/utils.ts).
// Wash/colors prep state is tracked separately by the dropdowns; the
// status dot only encodes overall job phase: Scheduled / In Production
// (auto-derived) / Complete.
const STATUS_DOT: Record<string, string> = {
  Scheduled: "bg-slate-400",
  "In Production": "bg-amber-500",
  Complete: "bg-emerald-500",
};

const WASH_OPTIONS: WashStatus[] = ["", "NA", "Not Scheduled", "Yes Scheduled", "Complete"];
const COLORS_OPTIONS: ColorsStatus[] = [
  "",
  "Match Required",
  "Sample Required",
  "Codes from Client",
  "Confirmed Colours",
];

const WASH_COLOR: Record<WashStatus, string> = {
  "": "bg-white text-slate-500 border-slate-300 hover:border-sky-300",
  NA: "bg-zinc-100 text-zinc-600 border-zinc-300",
  "Not Scheduled": "bg-amber-100 text-amber-800 border-amber-300",
  "Yes Scheduled": "bg-sky-100 text-sky-800 border-sky-400",
  Complete: "bg-emerald-500 text-white border-emerald-500",
};

const COLORS_COLOR: Record<ColorsStatus, string> = {
  "": "bg-white text-slate-500 border-slate-300 hover:border-violet-300",
  "Match Required": "bg-rose-100 text-rose-800 border-rose-300",
  "Sample Required": "bg-amber-100 text-amber-800 border-amber-300",
  "Codes from Client": "bg-sky-100 text-sky-800 border-sky-300",
  "Confirmed Colours": "bg-violet-500 text-white border-violet-500",
};

const WASH_LABEL: Record<WashStatus, string> = {
  "": "Wash",
  NA: "NA",
  "Not Scheduled": "Not Sched",
  "Yes Scheduled": "Sched",
  Complete: "Wash ✓",
};

const COLORS_LABEL: Record<ColorsStatus, string> = {
  "": "Colors",
  "Match Required": "Match",
  "Sample Required": "Sample",
  "Codes from Client": "Codes",
  "Confirmed Colours": "Colors ✓",
};

// Crew commitment status visualization. Encoded as both an icon (next to
// name) and a border style on the card itself — dashed when "Not Offered"
// so the card visually reads as TENTATIVE at a glance, vs locked-in solid
// for offered/confirmed.
const CREW_STATUS_ICON: Record<string, { glyph: string; cls: string; title: string }> = {
  "Not Offered": { glyph: "○", cls: "text-slate-400", title: "Crew not yet offered the job" },
  Offered: { glyph: "→", cls: "text-amber-600", title: "Offered to crew, awaiting confirmation" },
  Confirmed: { glyph: "✓", cls: "text-emerald-600", title: "Crew confirmed" },
};

// Comms-health for the card. Delegates to lib/commsCadence.ts which
// implements the CC SOP cadence (time-to-start driven, not flat 14d).
function commsHealth(job: ProductionJob): { level: "green" | "amber" | "rose" | "none"; tooltip: string } {
  const state = commsStateLib(job, todayISO());
  const lastStr = job.lastClientTouch ? `${job.lastClientTouch}` : "no contact logged";
  const nextStr = job.nextClientTouch ? `${job.nextClientTouch}` : "no follow-up scheduled";
  const tooltip = `${state.label} · ${state.bucket.label}\nLast: ${lastStr} · Next: ${nextStr}\n${state.detail}`;
  return { level: state.level, tooltip };
}

const COMMS_DOT_COLOR: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  none: "bg-zinc-300",
};

export function ProductionJobCard({
  job,
  onClick,
  height,
  isContinuation = false,
  isContinued = false,
  dimmed = false,
  searchMatched = false,
  onCycleCrewStatus,
  rainSeverity = "none",
  selected = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const isComplete = job.status === "Complete";
  // In Production = job is actively running. Subtle amber tint on the
  // card distinguishes "running" from "scheduled but not yet started"
  // (per Jared 2026-05-12). Distinct from Complete (grey).
  const isInProduction = job.status === "In Production";
  const isNotOffered = !isComplete && job.crewStatus === "Not Offered" && Boolean(job.crew);
  const hrs = effectiveHours(job);
  const crewIcon = !isComplete && job.crew ? CREW_STATUS_ICON[job.crewStatus] : null;
  const comms = commsHealth(job);
  // Days display reflects ACTUAL scheduled days (start→end span), not the
  // hours-based estimate. The hours number stays informational; the day
  // count is what's physically planned in the sheet. This matches how the
  // grid layout places the card and prevents "58h·3d" labels on a job
  // that's actually scheduled for 2 days.
  const totalDays = (() => {
    if (!job.startDate) return hrs > 0 ? daysToFit(hrs) : 0;
    const start = new Date(job.startDate + "T12:00:00Z");
    if (job.endDate) {
      const end = new Date(job.endDate + "T12:00:00Z");
      if (end >= start) return workingDaysBetween(start, end).length;
    }
    return hrs > 0 ? daysToFit(hrs) : 0;
  })();
  const hrsIsProxy = !(job.estHours && job.estHours > 0) && hrs > 0;

  // Density tiers based on rendered height (44px per day in day-row layout).
  // 1-day = ~36px → single line: name + $.
  // 2-day = ~80px → + status/hours metadata row.
  // 3+ day = ~124px+ → + crew tag + wash/colors dropdowns.
  const isShort = (height ?? 0) < 60;
  const isMedium = (height ?? 0) < 110;

  async function callAction(label: string, body: Record<string, unknown>) {
    setBusy(label);
    try {
      await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, ...body }),
      });
      startTransition(() => router.refresh());
    } finally {
      setTimeout(() => setBusy(null), 300);
    }
  }

  return (
    <div
      onClick={(e) => onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
        }
      }}
      role="button"
      tabIndex={0}
      title={`${job.name} · ${formatCurrency(job.bookedValue)}${hrs ? ` · ${hrs}h · ${totalDays}d` : ""}${isContinuation ? " (continued from prior)" : ""}${isContinued ? " (continues)" : ""}`}
      style={height ? { height: `${height}px` } : undefined}
      className={cn(
        "group relative w-full text-left border rounded-md transition-all duration-200 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-cc-accent overflow-hidden flex flex-col",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-md",
        dimmed && "opacity-25 hover:opacity-90",
        searchMatched && "ring-2 ring-amber-400 ring-offset-1 shadow-lg shadow-amber-400/30 z-10",
        // Not-Offered jobs get a dashed border so the eye reads them as
        // tentative — locked-in (Offered/Confirmed/Complete) cards stay
        // solid. Costs zero space and is unmistakable across a row.
        isNotOffered && "border-dashed",
        // Multi-select highlight — accent ring with bg tint, makes
        // selected cards unmistakable across the grid.
        selected && "ring-2 ring-cc-accent ring-offset-1 bg-cc-accent-soft/30",
        // Subtle hover lift + stronger shadow — gives the card a sense of
        // physicality you'd expect from Linear / Asana / Notion. Disabled
        // on completed cards (don't lift archived items).
        !isComplete && "hover:-translate-y-px hover:shadow-md",
        isShort ? "px-2 py-1" : "px-2.5 py-1.5",
        isContinuation && "rounded-t-none border-t-text-muted/30 border-t-dashed",
        isContinued && "rounded-b-none border-b-text-muted/30 border-b-dashed",
        isComplete
          ? cn(COMPLETE_EDGE, "bg-zinc-200/70 border-zinc-300 ring-1 ring-zinc-300/50 hover:border-zinc-500 hover:bg-zinc-200")
          : isInProduction
            ? cn("before:bg-amber-500", "bg-amber-50/60 border-amber-300 ring-1 ring-amber-300/40 elev-card hover:border-amber-500")
            : cn(MOV_EDGE[job.movability], "bg-surface border-border elev-card hover:border-cc-accent/50")
      )}
    >
      {/* Top row — name on the left, booked value on the right. Same on
          every card regardless of duration so the eye always finds the
          headline metric in the same place. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-1">
          {isComplete && (
            <CheckCircle2 className={cn("text-zinc-700 shrink-0", isShort ? "w-3 h-3" : "w-3.5 h-3.5")} />
          )}
          {/* Crew status icon — clickable to cycle Not Offered → Offered →
              Confirmed → Not Offered. stopPropagation so it doesn't open
              the drawer. ○ Not Offered, → Offered (amber), ✓ Confirmed
              (emerald). Sits before the name so it reads first. */}
          {crewIcon && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCycleCrewStatus?.();
              }}
              className={cn(
                "shrink-0 text-[11px] font-bold leading-none px-1 -mx-1 rounded hover:bg-zinc-100 transition-colors",
                crewIcon.cls
              )}
              title={`${crewIcon.title} (${job.crew}) — click to cycle`}
            >
              {crewIcon.glyph}
            </button>
          )}
          <span
            className={cn(
              "font-semibold leading-tight truncate",
              isShort ? "text-[12px]" : "text-[13px]",
              isComplete ? "text-zinc-700 line-through decoration-zinc-500/50 decoration-1" : "text-text-primary"
            )}
          >
            {job.name}
          </span>
        </div>
        {/* Rain warning — worst day in span. Rose = heavy (day-stopping),
            amber = light drizzle/showers (watch the forecast). */}
        {!isComplete && rainSeverity !== "none" && (
          <span
            className={cn(
              "text-[12px] leading-none shrink-0",
              rainSeverity === "heavy" ? "text-rose-600" : "text-amber-600"
            )}
            title={
              rainSeverity === "heavy"
                ? "Heavy rain forecast on at least one scheduled day — likely day-stopping"
                : "Light rain / drizzle forecast on at least one scheduled day"
            }
          >
            🌧
          </span>
        )}
        {/* Communication health — traffic-light dot encoding contact freshness. */}
        {!isComplete && comms.level !== "none" && (
          <span
            className={cn("inline-block w-2 h-2 rounded-full shrink-0", COMMS_DOT_COLOR[comms.level])}
            title={comms.tooltip}
          />
        )}
        {job.bookedValue > 0 && (
          <span
            className={cn(
              "font-extrabold tabular-nums shrink-0",
              isShort ? "text-[12px]" : "text-sm",
              isComplete ? "text-zinc-700" : "text-cc-navy"
            )}
          >
            {formatCurrency(job.bookedValue)}
          </span>
        )}
      </div>

      {/* Metadata row — status + hours·days on the left, wash + colors
          dropdowns on the right. Wash/colors are always visible regardless
          of card height because they're scanned constantly during
          planning; crew name was redundant (column header carries it) so
          it's been dropped from the body. */}
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] min-w-0",
          isShort ? "mt-0.5" : "mt-0.5",
          isComplete ? "text-zinc-600" : "text-text-muted"
        )}
      >
        {(() => {
          const eff = effectiveStatus(job);
          return (
            <span
              className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[eff] || "bg-slate-300")}
              title={eff === "In Production" ? "In Production (today is within the job's scheduled span)" : eff}
            />
          );
        })()}
        {hrs > 0 && (
          <span
            className={cn(
              "tabular-nums font-semibold shrink-0",
              hrsIsProxy && "text-text-muted/70 italic"
            )}
            title={
              hrsIsProxy
                ? `${hrs}h (booked $/100 proxy) · ~${totalDays}d at 25h/day`
                : `${hrs}h · ~${totalDays}d at 25h/day`
            }
          >
            {hrs}h·{totalDays}d
          </span>
        )}
        {!job.crew && (
          <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-rose-50 text-rose-700 font-bold shrink-0">
            No crew
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <StatusSelect
            label="Wash"
            value={job.washStatus}
            options={WASH_OPTIONS}
            colorMap={WASH_COLOR}
            labelMap={WASH_LABEL}
            busy={busy === "wash"}
            onChange={(v) => callAction("wash", { action: "wash", status: v })}
          />
          <StatusSelect
            label="Colors"
            value={job.colorsStatus}
            options={COLORS_OPTIONS}
            colorMap={COLORS_COLOR}
            labelMap={COLORS_LABEL}
            busy={busy === "colors"}
            onChange={(v) => callAction("colors", { action: "colors", status: v })}
          />
        </div>
      </div>

    </div>
  );
}

function StatusSelect<T extends string>({
  label,
  value,
  options,
  colorMap,
  labelMap,
  busy,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  colorMap: Record<T, string>;
  labelMap: Record<T, string>;
  busy: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={busy}
        className={cn(
          "shrink-0 appearance-none cursor-pointer pl-1.5 pr-5 py-0.5 text-[10px] font-semibold rounded border transition disabled:opacity-60",
          colorMap[value]
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6' viewBox='0 0 8 6'%3E%3Cpath fill='currentColor' d='M0 0l4 6 4-6z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 4px center",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-white text-text-primary">
            {labelMap[o]}
          </option>
        ))}
      </select>
      {busy && (
        <Loader2 className="absolute -right-4 w-3 h-3 animate-spin text-text-muted" />
      )}
    </div>
  );
}
