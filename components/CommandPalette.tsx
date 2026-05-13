"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowRight, X, ExternalLink } from "lucide-react";
import { HeatDot } from "./HeatBadge";
import { formatCurrency } from "@/lib/utils";
import type { ScoredOpportunity } from "@/lib/types";

interface Props {
  opportunities: ScoredOpportunity[];
  onPick: (opp: ScoredOpportunity) => void;
}

export function CommandPalette({ opportunities, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open with Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !open) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
          return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default: show top 8 by heat
      return [...opportunities]
        .sort((a, b) => b.heat.score - a.heat.score)
        .slice(0, 8);
    }
    return opportunities
      .filter((o) => {
        return (
          o.name.toLowerCase().includes(q) ||
          o.address.toLowerCase().includes(q) ||
          o.notes.toLowerCase().includes(q) ||
          o.leadSource.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          o.phone.toLowerCase().includes(q)
        );
      })
      .slice(0, 12);
  }, [opportunities, query]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) {
        onPick(r);
        setOpen(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-cc-navy-deep/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="absolute left-1/2 -translate-x-1/2 top-[10vh] w-full max-w-xl px-4">
        <div className="bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Search className="w-5 h-5 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={handleKey}
              placeholder="Search any lead — name, address, notes…"
              className="flex-1 bg-transparent text-base outline-none placeholder:text-text-muted"
            />
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-1">
            {results.length === 0 ? (
              <li className="p-6 text-center text-sm text-text-muted">
                No matches for &quot;{query}&quot;
              </li>
            ) : (
              results.map((opp, i) => (
                <li key={opp.id || opp.name}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onPick(opp);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition ${
                      i === active
                        ? "bg-cc-navy/5 text-text-primary"
                        : "text-text-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <HeatDot tier={opp.heat.tier} />
                      <div className="min-w-0">
                        <div className="font-semibold text-text-primary truncate">{opp.name}</div>
                        <div className="text-xs text-text-muted truncate">
                          {opp.stage}
                          {opp.address && ` · ${opp.address}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {opp.estValue > 0 && (
                        <span className="text-sm font-semibold text-cc-navy tabular-nums">
                          {formatCurrency(opp.estValue)}
                        </span>
                      )}
                      <ArrowRight className="w-4 h-4 text-text-muted" />
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-border bg-zinc-50 px-4 py-2 flex items-center justify-between text-[11px] text-text-muted">
            <div className="flex gap-3">
              <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
              <span><Kbd>↵</Kbd> open</span>
              <span><Kbd>esc</Kbd> close</span>
            </div>
            <div className="flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              <span>opens detail</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 bg-white border border-border rounded text-[10px] font-semibold text-text-secondary">
      {children}
    </kbd>
  );
}
