import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/types";

const STYLES: Record<Stage, string> = {
  "Verbal Yes": "bg-cc-accent text-white border-cc-accent",
  "Proposal Sent": "bg-blue-50 text-blue-800 border-blue-200",
  "On Hold": "bg-amber-50 text-amber-800 border-amber-200",
  "Long-Term": "bg-slate-100 text-slate-700 border-slate-200",
  Won: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Lost: "bg-rose-100 text-rose-800 border-rose-200",
  Archived: "bg-zinc-100 text-zinc-700 border-zinc-200",
  Unknown: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border",
        STYLES[stage] || STYLES.Unknown,
        className
      )}
    >
      {stage}
    </span>
  );
}
