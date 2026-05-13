"use client";

import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export type SegmentLens = "none" | "leadSource" | "jobSize";

const OPTIONS: { key: SegmentLens; label: string }[] = [
  { key: "none", label: "All" },
  { key: "leadSource", label: "By source" },
  { key: "jobSize", label: "By size" },
];

interface Props {
  value: SegmentLens;
  onChange: (v: SegmentLens) => void;
}

export function SegmentationLens({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <Tag className="w-3.5 h-3.5 text-text-muted" />
      <div className="inline-flex bg-zinc-100 rounded-md p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "text-[11px] font-semibold px-2 py-1 rounded transition",
              value === o.key
                ? "bg-white text-cc-navy shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function jobSizeBucket(value: number): string {
  if (value === 0) return "Unknown";
  if (value < 2000) return "< $2K";
  if (value < 5000) return "$2K – $5K";
  if (value < 10000) return "$5K – $10K";
  if (value < 20000) return "$10K – $20K";
  return "$20K+";
}
