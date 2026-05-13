"use client";

import { useState } from "react";
import { Calendar, AlertCircle, Sun } from "lucide-react";
import { OppCard } from "./OppCard";
import { cn, formatCurrencyShort } from "@/lib/utils";
import type { ActionZone } from "@/lib/types";

type Tab = "today" | "overdue" | "tomorrow";

interface Props {
  zone: ActionZone;
}

export function ActionZoneSection({ zone }: Props) {
  const initial: Tab =
    zone.overdue.length > 0
      ? "overdue"
      : zone.today.length > 0
      ? "today"
      : "tomorrow";
  const [tab, setTab] = useState<Tab>(initial);

  const counts = {
    today: zone.today.length,
    overdue: zone.overdue.length,
    tomorrow: zone.tomorrow.length,
  };

  const sumValue = (arr: { estValue: number }[]) =>
    arr.reduce((acc, o) => acc + o.estValue, 0);
  const values = {
    today: sumValue(zone.today),
    overdue: sumValue(zone.overdue),
    tomorrow: sumValue(zone.tomorrow),
  };

  const items =
    tab === "today" ? zone.today : tab === "overdue" ? zone.overdue : zone.tomorrow;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; tone: string }[] = [
    {
      key: "overdue",
      label: "Overdue",
      icon: <AlertCircle className="w-4 h-4" />,
      tone: "text-cc-danger",
    },
    {
      key: "today",
      label: "Today",
      icon: <Sun className="w-4 h-4" />,
      tone: "text-cc-accent",
    },
    {
      key: "tomorrow",
      label: "Tomorrow",
      icon: <Calendar className="w-4 h-4" />,
      tone: "text-cc-blue",
    },
  ];

  return (
    <section className="bg-surface rounded-2xl border border-border overflow-hidden">
      <div className="flex items-center gap-1 sm:gap-2 px-4 sm:px-5 pt-4 border-b border-border">
        {tabs.map((t) => {
          const active = tab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "relative flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-semibold transition rounded-t-md",
                active
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              <span className={active ? t.tone : ""}>{t.icon}</span>
              <span>{t.label}</span>
              <span
                className={cn(
                  "tabular-nums text-xs px-1.5 py-0.5 rounded-md",
                  active
                    ? "bg-cc-navy text-white"
                    : "bg-zinc-100 text-text-secondary"
                )}
              >
                {count}
              </span>
              {active && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-cc-accent rounded-full" />
              )}
            </button>
          );
        })}
        <div className="ml-auto pb-2 text-xs text-text-muted tabular-nums">
          {values[tab] > 0 && formatCurrencyShort(values[tab])}
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">✨</div>
            <p className="text-sm text-text-secondary">
              {tab === "overdue"
                ? "Nothing overdue. Inbox zero on follow-ups."
                : tab === "today"
                ? "Nothing scheduled for today."
                : "Nothing scheduled for tomorrow."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((opp) => (
              <OppCard key={opp.id || opp.name} opp={opp} emphasize={tab === "overdue"} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
