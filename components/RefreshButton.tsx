"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [doneFlash, setDoneFlash] = useState(false);

  async function handleRefresh() {
    if (loading || isPending) return;
    setLoading(true);
    try {
      await fetch("/api/revalidate", { method: "POST" });
      startTransition(() => {
        router.refresh();
      });
      setDoneFlash(true);
      setTimeout(() => setDoneFlash(false), 1400);
    } finally {
      setTimeout(() => setLoading(false), 500);
    }
  }

  const busy = loading || isPending;

  return (
    <button
      onClick={handleRefresh}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition",
        "bg-white/10 hover:bg-white/20 text-white/85 hover:text-white",
        "disabled:opacity-60 disabled:cursor-not-allowed"
      )}
      title="Pull the latest data from the sheet (skips the 5-min cache)"
      aria-label="Refresh dashboard data"
    >
      {doneFlash ? (
        <Check className="w-3.5 h-3.5 text-emerald-300" />
      ) : (
        <RefreshCw className={cn("w-3.5 h-3.5", busy && "animate-spin")} />
      )}
      <span className="hidden sm:inline">
        {busy ? "Refreshing…" : doneFlash ? "Updated" : "Refresh"}
      </span>
    </button>
  );
}
