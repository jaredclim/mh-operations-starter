import { cn } from "@/lib/utils";
import { HEAT_META, type HeatTier } from "@/lib/heat";

const SIZES = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
} as const;

export function HeatBadge({
  tier,
  size = "sm",
  className,
}: {
  tier: HeatTier;
  size?: "sm" | "md";
  className?: string;
}) {
  const m = HEAT_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold uppercase tracking-wide rounded-full border",
        SIZES[size],
        m.bg,
        m.color,
        m.border,
        className
      )}
      title={m.description}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function HeatDot({ tier, className }: { tier: HeatTier; className?: string }) {
  const dotClass: Record<HeatTier, string> = {
    hot: "bg-emerald-500",
    warm: "bg-amber-500",
    cool: "bg-sky-500",
    cold: "bg-slate-400",
  };
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full", dotClass[tier], className)}
      aria-hidden
    />
  );
}
