"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, Hammer, MapPin, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function Nav() {
  const pathname = usePathname();
  const tabs = [
    { href: "/leads", label: "Leads", icon: <Inbox className="w-3.5 h-3.5" /> },
    { href: "/", label: "Pipeline", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { href: "/production", label: "In Production", icon: <Hammer className="w-3.5 h-3.5" /> },
    { href: "/production/map", label: "Map", icon: <MapPin className="w-3.5 h-3.5" /> },
  ];
  return (
    <nav className="flex items-center gap-1">
      {tabs.map((t) => {
        // Exact match — avoids "/production" lighting up when on "/production/map"
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition",
              active ? "bg-white/15 text-white" : "text-white/65 hover:text-white hover:bg-white/10"
            )}
          >
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
