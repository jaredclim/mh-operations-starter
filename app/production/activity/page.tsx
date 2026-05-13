import type { Metadata } from "next";
import { fetchActivity, type ActivityEntry } from "@/lib/activity";
import { fetchProduction } from "@/lib/sheets";
import { Nav } from "@/components/Nav";
import { RefreshButton } from "@/components/RefreshButton";
import { OverflowMenu } from "@/components/OverflowMenu";
import Link from "next/link";
import { History } from "lucide-react";

export const metadata: Metadata = { title: "Activity" };
export const revalidate = 60;

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  schedule: { label: "Schedule", color: "bg-blue-100 text-blue-800 border-blue-200" },
  status: { label: "Status", color: "bg-amber-100 text-amber-800 border-amber-200" },
  wash: { label: "Wash", color: "bg-sky-100 text-sky-800 border-sky-200" },
  colors: { label: "Colors", color: "bg-purple-100 text-purple-800 border-purple-200" },
  crewStatus: { label: "Crew status", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  scope: { label: "Scope", color: "bg-amber-100 text-amber-800 border-amber-200" },
  punch: { label: "Punch", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  note: { label: "Note", color: "bg-zinc-100 text-zinc-800 border-zinc-200" },
  materials: { label: "Materials", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  touch: { label: "Client touch", color: "bg-rose-100 text-rose-800 border-rose-200" },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  movability: { label: "Movability", color: "bg-violet-100 text-violet-800 border-violet-200" },
  create: { label: "Created", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  renameCrew: { label: "Crew renamed", color: "bg-orange-100 text-orange-800 border-orange-200" },
  // Lead-specific
  snooze: { label: "Snooze", color: "bg-zinc-100 text-zinc-800 border-zinc-200" },
  stage: { label: "Stage", color: "bg-violet-100 text-violet-800 border-violet-200" },
  "setup-call": { label: "Setup call", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  reschedule: { label: "Reschedule", color: "bg-amber-100 text-amber-800 border-amber-200" },
  lost: { label: "Lost", color: "bg-rose-100 text-rose-800 border-rose-200" },
  "auto-archive": { label: "Auto-promote", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  "promoted-from-lead": { label: "From lead", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
};

type SourceFilter = "all" | "production" | "pipeline" | "leads";

function isProductionJobId(jobId: string): boolean {
  return /^P\d/.test(jobId);
}

function isLeadId(jobId: string): boolean {
  return /^L\d/.test(jobId);
}

function classifySource(jobId: string): "production" | "leads" | "pipeline" {
  if (isProductionJobId(jobId)) return "production";
  if (isLeadId(jobId)) return "leads";
  return "pipeline";
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const params = await searchParams;
  const source: SourceFilter =
    params.source === "production"
      ? "production"
      : params.source === "pipeline"
        ? "pipeline"
        : params.source === "leads"
          ? "leads"
          : "all";

  const [allEntries, jobs] = await Promise.all([
    fetchActivity({ limit: 500 }).catch(() => []),
    fetchProduction().catch(() => []),
  ]);
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));

  // Filter entries by source classification
  const entries = allEntries.filter((e) => {
    if (source === "all") return true;
    return classifySource(e.jobId) === source;
  });

  const counts = {
    all: allEntries.length,
    production: allEntries.filter((e) => classifySource(e.jobId) === "production").length,
    pipeline: allEntries.filter((e) => classifySource(e.jobId) === "pipeline").length,
    leads: allEntries.filter((e) => classifySource(e.jobId) === "leads").length,
  };

  // Group entries by Vancouver calendar day.
  const groups = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const day = (e.timestamp || "").split("T")[0] || "—";
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="bg-cc-navy text-white border-b border-cc-navy-deep sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 px-2 rounded-lg bg-white/95 flex items-center justify-center shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cc-logo.png" alt="Colour Craft" className="h-7 w-auto object-contain" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-cc-accent/90 font-semibold">
                Colour Craft
              </div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">Activity</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Nav />
            <RefreshButton />
            <OverflowMenu />
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
        <div className="bg-surface rounded-2xl border border-border px-4 py-3 flex items-center gap-3 justify-between flex-wrap">
          <div className="flex items-center gap-3">
            <History className="w-4 h-4 text-cc-accent" />
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Recent activity
              </div>
              <div className="text-sm text-text-secondary">
                {source === "all"
                  ? `${entries.length} events across all CC dashboards`
                  : source === "production"
                    ? `${entries.length} Production events`
                    : source === "leads"
                      ? `${entries.length} Leads events`
                      : `${entries.length} Pipeline (sales) events`}{". Newest first."}
              </div>
            </div>
          </div>
          <div className="inline-flex items-center bg-zinc-100 rounded-lg p-0.5 text-xs font-semibold">
            <Link
              href="/production/activity"
              className={
                "px-2.5 py-1 rounded-md transition " +
                (source === "all" ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary")
              }
            >
              All <span className="text-text-muted ml-1 tabular-nums">{counts.all}</span>
            </Link>
            <Link
              href="/production/activity?source=production"
              className={
                "px-2.5 py-1 rounded-md transition " +
                (source === "production" ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary")
              }
            >
              Production <span className="text-text-muted ml-1 tabular-nums">{counts.production}</span>
            </Link>
            <Link
              href="/production/activity?source=pipeline"
              className={
                "px-2.5 py-1 rounded-md transition " +
                (source === "pipeline" ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary")
              }
            >
              Pipeline <span className="text-text-muted ml-1 tabular-nums">{counts.pipeline}</span>
            </Link>
            <Link
              href="/production/activity?source=leads"
              className={
                "px-2.5 py-1 rounded-md transition " +
                (source === "leads" ? "bg-white text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary")
              }
            >
              Leads <span className="text-text-muted ml-1 tabular-nums">{counts.leads}</span>
            </Link>
          </div>
        </div>

        {groups.size === 0 ? (
          <div className="bg-surface rounded-2xl border border-border p-8 text-center text-text-muted">
            No activity logged yet. Make a change in the dashboard and it&apos;ll appear here.
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(groups.entries()).map(([day, dayEntries]) => (
              <section key={day} className="bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="bg-zinc-50 border-b border-border px-4 py-2 flex items-center justify-between">
                  <h2 className="text-xs uppercase tracking-wider font-bold text-text-primary tabular-nums">
                    {formatDayHeader(day)}
                  </h2>
                  <span className="text-[11px] text-text-muted font-semibold tabular-nums">
                    {dayEntries.length} event{dayEntries.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {dayEntries.map((e, i) => {
                    const meta = ACTION_LABELS[e.action] ?? {
                      label: e.action,
                      color: "bg-zinc-100 text-zinc-800 border-zinc-200",
                    };
                    const job = e.jobId ? jobById.get(e.jobId) : null;
                    return (
                      <li key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-zinc-50">
                        <span className="text-xs tabular-nums text-text-muted font-semibold w-16 shrink-0 mt-0.5">
                          {formatTime(e.timestamp)}
                        </span>
                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${meta.color} shrink-0 mt-0.5`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          {job ? (
                            <Link
                              href={`/production?job=${encodeURIComponent(e.jobId)}`}
                              className="text-sm font-semibold text-cc-blue hover:underline"
                            >
                              {job.name}
                            </Link>
                          ) : e.jobId ? (
                            <span className="text-sm font-semibold text-text-secondary">
                              {e.jobId}
                            </span>
                          ) : (
                            <span className="text-sm font-semibold text-text-secondary italic">
                              (system)
                            </span>
                          )}
                          <div className="text-sm text-text-secondary leading-snug">
                            {e.detail}
                          </div>
                        </div>
                        <span className="text-[11px] text-text-muted font-medium shrink-0 mt-0.5">
                          {e.actor}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatDayHeader(day: string): string {
  if (!day || day === "—") return "Unknown";
  const today = todayInVancouver();
  if (day === today) return `Today · ${formatLongDate(day)}`;
  const y = new Date(today + "T12:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return `Yesterday · ${formatLongDate(day)}`;
  return formatLongDate(day);
}

function formatLongDate(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(ts: string): string {
  if (!ts) return "";
  const [, timePart] = ts.split("T");
  if (!timePart) return "";
  const [hh, mm] = timePart.split(":");
  const h = parseInt(hh, 10);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mm}${period}`;
}

function todayInVancouver(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}
