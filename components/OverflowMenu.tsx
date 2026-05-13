"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreVertical, History } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Overflow menu — utility surfaces that don't earn top-nav space.
 * Pattern: top nav = places you LIVE in (Pipeline, Production, Map,
 * future Leads + KPIs). Kebab = places you INVESTIGATE in (Activity
 * log, future Settings, Crew Config, Subs list).
 *
 * This is where Linear/Stripe/Jobber/ServiceTitan put audit logs and
 * settings — never primary nav real estate. Following that pattern
 * keeps the top header readable as the surface count grows.
 */
export function OverflowMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    {
      href: "/production/activity",
      label: "Activity log",
      icon: <History className="w-4 h-4" />,
      description: "Audit trail of every change",
    },
    // Future: Settings, Crew config, Subs list, Export/Print, etc.
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center w-9 h-9 rounded-md transition",
          open ? "bg-white/15 text-white" : "text-white/70 hover:text-white hover:bg-white/10"
        )}
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 bg-surface text-text-primary rounded-xl shadow-2xl ring-1 ring-black/5 border border-border overflow-hidden z-50"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-text-muted bg-zinc-50 border-b border-border">
            Utilities
          </div>
          <ul>
            {items.map((it) => {
              const active = pathname === it.href;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5 hover:bg-zinc-50 transition-colors",
                      active && "bg-cc-accent-soft/50"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0",
                        active ? "text-cc-accent" : "text-text-muted"
                      )}
                    >
                      {it.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">
                        {it.label}
                      </span>
                      <span className="block text-xs text-text-muted leading-snug">
                        {it.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
