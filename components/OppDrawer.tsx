"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Phone, Mail, MapPin, ExternalLink, Calendar, Flame, StickyNote, Loader2, ListChecks, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { StageBadge } from "./StageBadge";
import { HeatBadge } from "./HeatBadge";
import { DrawerActions } from "./DrawerActions";
import { SalesCommunicationSection } from "./SalesCommunicationSection";
import { cn, formatCurrency, relativeDate, todayISO } from "@/lib/utils";
import type { ScoredOpportunity, TodoItem } from "@/lib/types";

interface Props {
  opp: ScoredOpportunity;
  open: boolean;
  onClose: () => void;
}

const SHEET_BASE = "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit";

/**
 * Build a valid DripJobs deal URL from whatever's stored in the sheet's
 * DripJobs Link column. Three formats appear in real data:
 *   - Full URL: "https://app.dripjobs.com/deal/2764725" — pass through
 *   - "Deal #2764725" or "deal #2764725" — construct URL from id
 *   - Plain "2764725" — construct URL from id
 *   - Anything else — return null (don't render a broken link)
 */
function dripJobsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\/[^\s]*app\.dripjobs\.com\/deal\/\d+/i.test(trimmed)) return trimmed;
  const idMatch = trimmed.match(/(\d{4,})/);
  if (idMatch) return `https://app.dripjobs.com/deal/${idMatch[1]}`;
  return null;
}

/** Parse the leading [date]: entry from Notes — gives an at-a-glance
 *  context summary without needing structured tags. Falls back to first
 *  200 chars if no dated entry. Returns null when notes are empty. */
function firstNoteEntry(notes: string): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (!trimmed) return null;
  // Find first [date] block and its content up to the next [date] or end
  const match = trimmed.match(/\[\d{4}-\d{2}-\d{2}[^\]]*\]:?\s*([\s\S]*?)(?=\n\s*\[\d{4}-\d{2}-\d{2}|$)/);
  if (match && match[1].trim()) return match[1].trim();
  return trimmed.slice(0, 240) + (trimmed.length > 240 ? "…" : "");
}

export function OppDrawer({ opp, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const today = todayISO();
  const sheetLink = `${SHEET_BASE}#gid=0&range=B${opp.id ? Number(opp.id) + 1 : 2}`;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute right-0 top-0 h-full w-full sm:max-w-xl bg-surface shadow-2xl flex flex-col"
          >
        <header className="flex items-start justify-between p-5 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <HeatBadge tier={opp.heat.tier} size="md" />
              <StageBadge stage={opp.stage} />
              {opp.promise && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-cc-danger">
                  <Flame className="w-3.5 h-3.5" />
                  PROMISE
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-text-primary truncate">{opp.name}</h2>
            {opp.estValue > 0 && (
              <div className="mt-1 text-2xl font-bold text-cc-navy tabular-nums">
                {formatCurrency(opp.estValue)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-100 text-text-secondary"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Communication — top-of-drawer surface for managing sales cadence.
              Phase chip + state chip + last/next touch + smart cadence buttons. */}
          <SalesCommunicationSection opp={opp} />

          {/* Quick context — the estimate / first note pulled to the top so
              Jared doesn't have to expand Notes to see what the deal is.
              Mirrors the Production drawer's Summary card. */}
          {(() => {
            const summary = firstNoteEntry(opp.notes);
            if (!summary) return null;
            return (
              <section className="bg-cc-accent-soft/30 border border-cc-accent/20 rounded-lg p-3 -mx-1">
                <h3 className="text-xs uppercase tracking-wider font-bold text-cc-navy mb-1.5">
                  Quick Summary
                </h3>
                <div className="text-sm text-text-primary leading-snug whitespace-pre-wrap">
                  {summary}
                </div>
              </section>
            );
          })()}

          {/* Quick action buttons — log touches, snooze, change stage, mark Won/Lost.
              Stays as the action toolkit below the cadence-driven Communication
              section above. */}
          <section className="bg-zinc-50 -mx-5 px-5 py-4 border-y border-border">
            <DrawerActions opp={opp} onClose={onClose} />
          </section>

          <section className="space-y-1.5 text-sm">
            <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-1">
              Contact
            </h3>
            {opp.phone && (
              <a
                href={`tel:${opp.phone.replace(/\s+/g, "")}`}
                className="flex items-center gap-2 text-cc-blue hover:underline"
              >
                <Phone className="w-4 h-4" /> {opp.phone}
              </a>
            )}
            {opp.email && (
              <a
                href={`mailto:${opp.email}`}
                className="flex items-center gap-2 text-cc-blue hover:underline"
              >
                <Mail className="w-4 h-4" /> {opp.email}
              </a>
            )}
            {opp.address && (
              <div className="flex items-start gap-2 text-text-secondary">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0" /> <span>{opp.address}</span>
              </div>
            )}
          </section>

          {/* Timeline + context — compressed from the original 9-field grid.
              Last Touch / Next Follow-Up moved to Communication section above.
              Priority Score removed (redundant with Heat Score). */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Lead Source" value={opp.leadSource} />
            <Field label="Estimate Date" value={opp.estDate || "—"} />
            <Field label="Proposal Date" value={opp.proposalDate || "—"} />
            <Field
              label="Promise"
              value={opp.promise ? `Yes${opp.promisedTime ? ` · ${opp.promisedTime}` : ""}` : "No"}
            />
            <Field
              label="Call Attempts"
              value={opp.callAttempts != null ? String(opp.callAttempts) : "—"}
            />
            {/* Spouse-at-Estimate field removed 2026-05-11 — Jared doesn't
                track it consistently enough to be useful. Heat scoring also
                stopped using it. Sheet column AC stays for back-compat. */}
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">
              Heat Score
            </h3>
            <div className="bg-zinc-50 border border-border rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="text-2xl font-bold text-text-primary tabular-nums">
                  {opp.heat.score}
                </div>
                <div className="text-xs text-text-secondary">/100</div>
                <div className="ml-auto">
                  <HeatBadge tier={opp.heat.tier} size="md" />
                </div>
              </div>
              <ul className="space-y-1 text-sm text-text-secondary">
                {opp.heat.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-text-muted">·</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {opp.lastEmailSnippet && <LastEmailCollapsible opp={opp} />}

          {/* To-Do List — structured checklist. Distinct from Notes
              (timestamped log) and System Activity (auto event log). The
              card surfaces a 📋 N badge when any item is incomplete so
              Jared sees at-a-glance which leads have outstanding work. */}
          {opp.id && (
            <TodoListSection leadId={opp.id} initial={opp.todoList || []} />
          )}

          {/* Notes Timeline — durable, always-visible. Both Jared and the
              production manager see every note added by either of them.
              Inline "Add note" textarea so the path from "I want to leave
              a note" → "it's saved and visible" is one input + one click. */}
          {opp.id && <NotesTimeline leadId={opp.id} notes={opp.notes || ""} />}

          {opp.id && <ActivityCollapsible leadId={opp.id} />}
        </div>

        <footer className="border-t border-border p-4 flex items-center justify-end gap-2">
          <a
            href={sheetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
          >
            <Calendar className="w-4 h-4" />
            Open in Sheet
          </a>
          {(() => {
            const url = dripJobsUrl(opp.dripJobsLink);
            if (!url) return null;
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-cc-navy hover:bg-cc-navy-deep rounded-lg px-3 py-2"
              >
                <ExternalLink className="w-4 h-4" />
                Open in DripJobs
              </a>
            );
          })()}
        </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-text-primary">{value}</div>
    </div>
  );
}

function LastEmailCollapsible({ opp }: { opp: ScoredOpportunity }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold">Last Email</h3>
        <span className="text-[11px] text-text-muted group-hover:text-text-primary">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="mt-2 bg-zinc-50 border border-border rounded-md p-3 text-sm text-text-secondary">
          <div className="text-xs text-text-muted mb-1">
            {opp.lastEmailReceived
              ? `Received ${opp.lastEmailReceived}`
              : opp.lastEmailSent
                ? `Sent ${opp.lastEmailSent}`
                : ""}
          </div>
          {opp.lastEmailSnippet}
        </div>
      )}
    </section>
  );
}

function ActivityCollapsible({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<{ timestamp: string; action: string; detail: string; actor: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/activity?jobId=${encodeURIComponent(leadId)}&limit=20`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setActivity(j.entries || []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId]);

  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div>
          <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold">System Activity</h3>
          <div className="text-[10px] text-text-muted italic mt-0.5">Auto-logged touches, snoozes, stage changes — not notes</div>
        </div>
        <span className="text-[11px] text-text-muted group-hover:text-text-primary">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          {loading && <div className="text-xs text-text-muted py-2">Loading…</div>}
          {!loading && activity.length === 0 && (
            <div className="text-xs text-text-muted italic py-2">No activity yet for this lead.</div>
          )}
          {!loading && activity.length > 0 && (
            <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {activity.map((e, i) => (
                <li key={i} className="text-xs bg-zinc-50 border border-border rounded-md px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text-primary">{e.action}</span>
                    <span className="text-text-muted tabular-nums shrink-0">{e.timestamp.split("T")[1]?.slice(0, 5) || ""}</span>
                  </div>
                  <div className="text-text-secondary mt-0.5 leading-snug">{e.detail}</div>
                  <div className="text-[10px] text-text-muted tabular-nums">{e.timestamp.split("T")[0]}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Parse a Notes blob into discrete dated entries. Notes are appended
 * via `appendNote()` in lib/leadActions.ts which prepends new entries
 * as `[YYYY-MM-DD]: text`, separated by blank lines. Older content
 * (pre-structured, or appended manually in the sheet) lands as a single
 * "Earlier notes" block with date = null so nothing is dropped.
 */
function parseNotesIntoEntries(notes: string): { date: string | null; body: string }[] {
  if (!notes || !notes.trim()) return [];
  const trimmed = notes.trim();
  const entries: { date: string | null; body: string }[] = [];
  // Match `[YYYY-MM-DD ...]:` headers and capture content until the next
  // dated header or end of string. The optional trailing content after
  // the date is preserved (used for source/tags like `[2026-05-09 EOD]:`).
  const regex = /\[(\d{4}-\d{2}-\d{2})([^\]]*)\]:?\s*([\s\S]*?)(?=\n\s*\[\d{4}-\d{2}-\d{2}|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    // Any content BEFORE the first dated header is "Earlier notes".
    if (match.index > lastIndex) {
      const pre = trimmed.slice(lastIndex, match.index).trim();
      if (pre) entries.push({ date: null, body: pre });
    }
    entries.push({ date: match[1], body: match[3].trim() });
    lastIndex = regex.lastIndex;
  }
  // Trailing content after the last dated block (rare — usually all
  // content fits inside a date block).
  if (lastIndex < trimmed.length) {
    const tail = trimmed.slice(lastIndex).trim();
    if (tail) entries.push({ date: null, body: tail });
  }
  // If no dated headers existed at all, dump everything as Earlier notes.
  if (entries.length === 0) entries.push({ date: null, body: trimmed });
  return entries;
}

/**
 * Always-visible Notes Timeline. Replaces the old collapsed Notes section.
 * Bug it fixes: Jared added a note via the drawer → toast said "Saved" →
 * note landed in column S correctly → but the Notes section was
 * collapsed by default so Jared had to expand "Notes" to see it. The
 * note appeared visible only in System Activity, which made him think
 * notes weren't being captured.
 *
 * Now: notes are the primary, always-visible surface. Inline textarea
 * for adding new notes so the "leave a note → see it landed" loop is
 * tight. Both Jared and the production manager open this drawer and
 * see every note ever left.
 */
function NotesTimeline({ leadId, notes }: { leadId: string; notes: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const today = todayISO();

  const entries = parseNotesIntoEntries(notes);
  // Newest first is already the storage order (appendNote prepends).
  const INITIAL = 5;
  const visible = showAll ? entries : entries.slice(0, INITIAL);
  const hiddenCount = Math.max(0, entries.length - INITIAL);

  async function saveNote() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, action: "note", text: body }),
      });
      if (res.ok) {
        setJustSaved(body.slice(0, 60) + (body.length > 60 ? "…" : ""));
        setText("");
        startTransition(() => router.refresh());
        setTimeout(() => setJustSaved(null), 3500);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    // Cmd/Ctrl + Enter to save — keeps Enter free for newlines inside
    // a multi-paragraph note.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveNote();
    }
  }

  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5 text-cc-navy" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-cc-navy">
            Notes
          </h3>
          {entries.length > 0 && (
            <span className="text-[10px] text-text-muted tabular-nums">
              ({entries.length})
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-muted italic">
          Visible to Jared + production manager
        </span>
      </div>

      {/* Inline composer — single textarea + save. Cmd/Ctrl+Enter to save. */}
      <div className="mb-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Add a note — what happened, what's next? (Cmd/Ctrl+Enter to save)"
          rows={2}
          disabled={busy}
          className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-cc-accent focus:bg-white resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between mt-1.5">
          {justSaved ? (
            <div className="text-[11px] text-emerald-700 font-semibold">
              ✓ Saved: &ldquo;{justSaved}&rdquo;
            </div>
          ) : (
            <div className="text-[10px] text-text-muted">
              Notes are timestamped and prepended to the timeline below
            </div>
          )}
          <button
            type="button"
            onClick={saveNote}
            disabled={!text.trim() || busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <StickyNote className="w-3 h-3" />}
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      {/* Timeline of entries. Today's entries get an emerald left rail so
          Jared can scan to "what landed today" without reading dates. */}
      {entries.length === 0 ? (
        <div className="text-xs text-text-muted italic py-3 text-center bg-zinc-50 rounded-md border border-dashed border-border">
          No notes yet — add the first one above
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((entry, i) => {
            const isToday = entry.date === today;
            return (
              <li
                key={i}
                className={
                  "rounded-md border bg-zinc-50/60 px-3 py-2 text-sm leading-relaxed " +
                  (isToday
                    ? "border-emerald-200 bg-emerald-50/40 border-l-4 border-l-emerald-500"
                    : "border-border")
                }
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
                    {entry.date ?? "Earlier notes"}
                  </span>
                  {isToday && (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">
                      Today
                    </span>
                  )}
                </div>
                <div className="text-text-primary whitespace-pre-wrap">
                  {entry.body}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 w-full text-center text-[11px] text-cc-blue hover:text-cc-navy hover:underline font-semibold"
        >
          Show {hiddenCount} older note{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
      {showAll && entries.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 w-full text-center text-[11px] text-text-muted hover:text-text-primary font-semibold"
        >
          Collapse
        </button>
      )}
    </section>
  );
}

/**
 * Structured To-Do List — mirrors ProductionJob's punchList. Optimistic
 * UI: state updates locally on every change and pushes the full array
 * to the server (column AE on Opportunities). Same persistence pattern
 * keeps the codepath simple and reuses the punchList serializer.
 *
 * The card uses opp.todoList.filter(t => !t.done).length to show a small
 * badge with the open-count — that's the at-a-glance signal Jared
 * wanted without cluttering the card with text.
 */
function TodoListSection({ leadId, initial }: { leadId: string; initial: TodoItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Reconcile when the server sends new initial values (e.g. after a
  // router.refresh from another action). Without this the section
  // would freeze on the snapshot at first mount.
  useEffect(() => {
    setItems(initial);
  }, [initial]);

  const openCount = items.filter((t) => !t.done).length;
  const doneCount = items.length - openCount;

  async function save(next: TodoItem[]) {
    setItems(next);
    setBusy(true);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, action: "todo", items: next }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setDraft("");
    save([...items, { id, text, done: false }]);
  }
  function toggleItem(id: string) {
    save(items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }
  function removeItem(id: string) {
    save(items.filter((t) => t.id !== id));
  }

  return (
    <section className="bg-white border border-border rounded-lg p-3 -mx-1">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5 text-cc-navy" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-cc-navy">
            To-Do List
          </h3>
          {items.length > 0 && (
            <span className="text-[10px] font-bold tabular-nums text-text-secondary">
              {doneCount}/{items.length}
            </span>
          )}
          {openCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">
              {openCount} open
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-muted italic">
          Card shows a badge when items are open
        </span>
      </div>

      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-2 group bg-zinc-50 border border-border rounded-md px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggleItem(it.id)}
                disabled={busy}
                className="mt-0.5 w-4 h-4 accent-emerald-600 cursor-pointer shrink-0"
                aria-label={it.done ? "Mark incomplete" : "Mark complete"}
              />
              <span
                className={cn(
                  "flex-1 text-sm leading-snug",
                  it.done ? "line-through text-text-muted" : "text-text-primary"
                )}
              >
                {it.text}
              </span>
              <button
                onClick={() => removeItem(it.id)}
                disabled={busy}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-rose-600 transition-opacity shrink-0"
                aria-label="Delete item"
                title="Delete item"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Add a to-do (e.g. send soffit-only option to Carol)"
          disabled={busy}
          className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent disabled:opacity-60"
        />
        <button
          onClick={addItem}
          disabled={!draft.trim() || busy}
          className="px-2.5 py-1.5 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
    </section>
  );
}
