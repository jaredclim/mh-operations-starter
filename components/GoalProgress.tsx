import { Target } from "lucide-react";
import { formatCurrencyShort, cn } from "@/lib/utils";

interface Props {
  weeklyBooked: number;
  weeklyTarget: number;
  monthlyBooked: number;
  monthlyTarget: number;
}

export function GoalProgress({
  weeklyBooked,
  weeklyTarget,
  monthlyBooked,
  monthlyTarget,
}: Props) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
      <ProgressCard
        label="This week"
        booked={weeklyBooked}
        target={weeklyTarget}
        period="week"
      />
      <ProgressCard
        label="This month"
        booked={monthlyBooked}
        target={monthlyTarget}
        period="month"
      />
    </section>
  );
}

function ProgressCard({
  label,
  booked,
  target,
  period,
}: {
  label: string;
  booked: number;
  target: number;
  period: "week" | "month";
}) {
  const pct = target > 0 ? Math.min(100, (booked / target) * 100) : 0;
  const remaining = Math.max(0, target - booked);
  const onPace = pct >= paceExpected(period);

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-cc-accent" />
          <span className="text-xs uppercase tracking-wider font-bold text-text-secondary">
            {label}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full",
            onPace ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          )}
        >
          {onPace ? "On pace" : "Behind"}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
          {formatCurrencyShort(booked)}
        </span>
        <span className="text-sm text-text-muted tabular-nums">
          / {formatCurrencyShort(target)}
        </span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-zinc-100 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            pct >= 100 ? "bg-emerald-500" : pct >= paceExpected(period) ? "bg-cc-accent" : "bg-amber-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-text-secondary">
        {pct >= 100 ? (
          <span className="text-emerald-700 font-semibold">
            Goal hit — {formatCurrencyShort(booked - target)} over.
          </span>
        ) : (
          <span>
            {formatCurrencyShort(remaining)} to goal · {Math.round(pct)}% complete
          </span>
        )}
      </div>
    </div>
  );
}

function paceExpected(period: "week" | "month"): number {
  // Simple linear pace based on day-of-period. Vancouver TZ.
  const now = new Date();
  if (period === "week") {
    // Mon=0..Sun=6 expected pace
    const dow = (now.getDay() + 6) % 7; // Mon=0
    return ((dow + 1) / 7) * 100;
  }
  // Month
  const dom = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (dom / lastDay) * 100;
}
