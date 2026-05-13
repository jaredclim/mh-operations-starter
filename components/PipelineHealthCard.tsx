"use client";

import { useState } from "react";
import { AlertTriangle, Snowflake, Phone, Mail, ChevronDown, ChevronUp, Flame, X } from "lucide-react";
import { HEAT_META, type HeatTier } from "@/lib/heat";
import { formatCurrency, formatCurrencyShort, todayISO } from "@/lib/utils";
import type { PipelineHealth, ScoredOpportunity } from "@/lib/types";
import { OppDrawer } from "./OppDrawer";
import { QuickLogChannels } from "./HeadlinePanel";

interface Props {
  health: PipelineHealth;
  active: ScoredOpportunity[];
}

type ExpandedStat = "promises" | "rotting" | "no-fu" | HeatTier | null;

export function PipelineHealthCard({ health, active }: Props) {
  const totalActive = health.activeCount;
  const [expanded, setExpanded] = useState<ExpandedStat>(null);
  const [openOpp, setOpenOpp] = useState<ScoredOpportunity | null>(null);

  const today = todayISO();
  const todayMs = new Date(today + "T12:00:00Z").getTime();

  // Compute opp lists per stat — pre-filtered, ready to expand
  const promisesList = active.filter((o) => o.promise);
  const rottingList = active.filter((o) => {
    if (!o.lastTouchDate) return false;
    const daysSince = Math.round((todayMs - new Date(o.lastTouchDate + "T12:00:00Z").getTime()) / 86400000);
    return daysSince > 21;
  });
  const noFuList = active.filter((o) => !o.nextFollowUpDate);

  function toggle(key: ExpandedStat) {
    setExpanded((current) => (current === key ? null : key));
  }

  // Sum value for stat banner
  const promisesValue = promisesList.reduce((s, o) => s + o.estValue, 0);
  const rottingValue = rottingList.reduce((s, o) => s + o.estValue, 0);
  const noFuValue = noFuList.reduce((s, o) => s + o.estValue, 0);

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cc-navy via-cc-navy-deep to-[#02152A] text-white shadow-xl">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 20%, rgba(232,146,60,0.25) 0%, transparent 45%), radial-gradient(circle at 10% 90%, rgba(96,165,250,0.18) 0%, transparent 40%)",
          }}
          aria-hidden
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 p-6 sm:p-8">
          {/* Pipeline value */}
          <div className="flex flex-col justify-center">
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              Pipeline Value
            </div>
            <div className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums">
              {formatCurrency(health.pipelineValue)}
            </div>
            <div className="mt-2 text-sm text-white/70 tabular-nums">
              {totalActive} active opportunities
            </div>
            <div className="mt-3 text-[11px] text-white/40">
              Sum of Est Value across all active leads in the sheet.
            </div>
          </div>

          {/* Heat distribution */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              Pipeline Heat
            </div>
            <HeatBars
              distribution={health.heatDistribution}
              totalCount={totalActive}
              expanded={expanded}
              onToggle={toggle}
            />
          </div>

          {/* Pipeline Attention column — click to expand any stat to see WHO */}
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-cc-accent font-semibold">
              Pipeline Attention
            </div>
            <ClickableStat
              icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}
              label="Promises pending"
              count={health.promisesPending}
              value={promisesValue}
              highlight={health.promisesPending > 0}
              expanded={expanded === "promises"}
              onClick={() => toggle("promises")}
            />
            <ClickableStat
              icon={<Snowflake className="w-4 h-4 text-sky-300" />}
              label="Rotting (>21d cold)"
              count={health.rotting}
              value={rottingValue}
              highlight={health.rotting > 0}
              expanded={expanded === "rotting"}
              onClick={() => toggle("rotting")}
            />
            <ClickableStat
              icon={<AlertTriangle className="w-4 h-4 text-amber-300" />}
              label="No follow-up date"
              count={noFuList.length}
              value={noFuValue}
              highlight={noFuList.length > 0}
              expanded={expanded === "no-fu"}
              onClick={() => toggle("no-fu")}
            />
          </div>
        </div>

        {/* Expanded panel — appears below the 3-col grid when a stat is selected */}
        {expanded && (
          <div className="relative border-t border-white/10 bg-black/15 backdrop-blur-sm px-6 sm:px-8 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-[0.2em] text-cc-accent font-semibold">
                {expandedLabel(expanded)}
              </h3>
              <button
                onClick={() => setExpanded(null)}
                className="text-white/60 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ExpandedList
              opps={listFor(expanded, promisesList, rottingList, noFuList, active)}
              onOpenDrawer={(opp) => setOpenOpp(opp)}
              statKey={expanded}
            />
          </div>
        )}
      </section>
      {openOpp && <OppDrawer opp={openOpp} open={true} onClose={() => setOpenOpp(null)} />}
    </>
  );
}

function listFor(
  key: ExpandedStat,
  promises: ScoredOpportunity[],
  rotting: ScoredOpportunity[],
  noFu: ScoredOpportunity[],
  active: ScoredOpportunity[]
): ScoredOpportunity[] {
  if (key === "promises") return promises;
  if (key === "rotting") return rotting;
  if (key === "no-fu") return noFu;
  if (key === "hot" || key === "warm" || key === "cool" || key === "cold") {
    return active.filter((o) => o.heat.tier === key);
  }
  return [];
}

function expandedLabel(key: ExpandedStat): string {
  if (key === "promises") return "Promises pending";
  if (key === "rotting") return "Rotting leads (>21d since last touch)";
  if (key === "no-fu") return "No follow-up date set";
  if (key === "hot") return "Hot leads";
  if (key === "warm") return "Warm leads";
  if (key === "cool") return "Cool leads";
  if (key === "cold") return "Cold leads";
  return "";
}

function ClickableStat({
  icon,
  label,
  count,
  value,
  highlight,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  value: number;
  highlight?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const hasItems = count > 0;
  return (
    <button
      onClick={onClick}
      disabled={!hasItems}
      className={`w-full flex items-center justify-between gap-3 px-2 py-1.5 -mx-2 rounded-md transition ${
        hasItems ? "hover:bg-white/8 cursor-pointer" : "cursor-default opacity-70"
      } ${expanded ? "bg-white/10" : ""}`}
    >
      <div className="flex items-center gap-2 text-sm text-white/70 min-w-0">
        {icon}
        <span className="truncate text-left">{label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {value > 0 && (
          <span className="text-[11px] text-white/50 tabular-nums">{formatCurrencyShort(value)}</span>
        )}
        <span
          className={`text-base font-semibold tabular-nums ${
            highlight ? "text-white" : "text-white/90"
          }`}
        >
          {count}
        </span>
        {hasItems && (
          <span className="text-white/40">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        )}
      </div>
    </button>
  );
}

function ExpandedList({
  opps,
  onOpenDrawer,
  statKey,
}: {
  opps: ScoredOpportunity[];
  onOpenDrawer: (opp: ScoredOpportunity) => void;
  statKey: ExpandedStat;
}) {
  if (opps.length === 0) {
    return <p className="text-sm text-white/60 italic">No opportunities in this category.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {opps.map((opp) => {
        const id = opp.id || opp.name;
        return (
          <li
            key={id}
            className="bg-white/8 rounded-lg px-3 py-2 flex items-center gap-3 hover:bg-white/12 transition cursor-pointer"
            onClick={() => onOpenDrawer(opp)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                {opp.promise && <Flame className="w-3 h-3 text-rose-300 shrink-0" />}
                <span className="font-semibold text-sm truncate">{opp.name}</span>
                {opp.estValue > 0 && (
                  <span className="text-[11px] font-bold text-cc-accent tabular-nums shrink-0">
                    {formatCurrency(opp.estValue).replace(/\.00$/, "")}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-white/60 truncate">
                {opp.stage}
                {statKey === "promises" && opp.promisedTime && ` · promised by ${opp.promisedTime}`}
                {statKey === "rotting" && opp.lastTouchDate && ` · last touch ${opp.lastTouchDate}`}
              </div>
            </div>
            <QuickLogChannels opp={opp} />
          </li>
        );
      })}
    </ul>
  );
}

function HeatBars({
  distribution,
  totalCount,
  expanded,
  onToggle,
}: {
  distribution: PipelineHealth["heatDistribution"];
  totalCount: number;
  expanded: ExpandedStat;
  onToggle: (key: HeatTier) => void;
}) {
  const tiers: HeatTier[] = ["hot", "warm", "cool", "cold"];
  const colors: Record<HeatTier, string> = {
    hot: "bg-emerald-400",
    warm: "bg-amber-400",
    cool: "bg-sky-400",
    cold: "bg-slate-400",
  };
  const totalForStack = totalCount || 1;

  return (
    <div className="mt-3 space-y-3">
      <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
        {tiers.map((t) => {
          const pct = (distribution[t].count / totalForStack) * 100;
          return (
            <div key={t} className={colors[t]} style={{ width: `${pct}%` }} title={`${HEAT_META[t].label}: ${distribution[t].count}`} />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {tiers.map((t) => {
          const isExpanded = expanded === t;
          const hasItems = distribution[t].count > 0;
          return (
            <button
              key={t}
              onClick={() => hasItems && onToggle(t)}
              disabled={!hasItems}
              className={`flex items-center justify-between px-1.5 py-1 -mx-1.5 rounded-md transition ${
                hasItems ? "hover:bg-white/8 cursor-pointer" : "cursor-default"
              } ${isExpanded ? "bg-white/10" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${colors[t]}`} aria-hidden />
                <span className="text-white/80 capitalize">{HEAT_META[t].label}</span>
              </div>
              <div className="tabular-nums text-white/60 text-xs flex items-center gap-1">
                <span className="font-semibold text-white/90">{distribution[t].count}</span>
                <span>{formatCurrencyShort(distribution[t].value)}</span>
                {hasItems && (
                  <span className="text-white/40 ml-0.5">
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
