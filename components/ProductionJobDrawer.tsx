"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, Mail, MapPin, Loader2, ListChecks, Plus, Trash2, History, CheckCircle2, Pencil, PlayCircle } from "lucide-react";
import { cn, effectiveStatus, formatCurrency, todayISO } from "@/lib/utils";
import type { Movability, ProductionJob, PunchItem } from "@/lib/types";
import { ProductionCommunicationSection } from "./ProductionCommunicationSection";

interface Props {
  job: ProductionJob;
  open: boolean;
  onClose: () => void;
  crews: string[];
}

// Status picker removed 2026-05-10 per audit. The two states (Scheduled /
// Complete) are now handled by: default = Scheduled, footer "Mark Complete"
// button to mark done. "In Production" auto-derives from today vs dates.

export function ProductionJobDrawer({ job, open, onClose, crews }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [crewDraft, setCrewDraft] = useState(job.crew);
  const [startDraft, setStartDraft] = useState(job.startDate || "");
  const [endDraft, setEndDraft] = useState(job.endDate || "");
  const [estHoursDraft, setEstHoursDraft] = useState(job.estHours?.toString() || "");
  const [valueDraft, setValueDraft] = useState(job.bookedValue > 0 ? String(Math.round(job.bookedValue)) : "");
  const [valueEditing, setValueEditing] = useState(false);
  // scopeDraft/scopeDirty removed with Scope section (2026-05-10 audit)
  const [punchItems, setPunchItems] = useState<PunchItem[]>(job.punchList || []);
  const [newPunchText, setNewPunchText] = useState("");
  const [activity, setActivity] = useState<{ timestamp: string; action: string; detail: string; actor: string }[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  // Comms state moved into ProductionCommunicationSection (2026-05-10).

  useEffect(() => {
    setCrewDraft(job.crew);
    setStartDraft(job.startDate || "");
    setEndDraft(job.endDate || "");
    setEstHoursDraft(job.estHours?.toString() || "");
    setValueDraft(job.bookedValue > 0 ? String(Math.round(job.bookedValue)) : "");
    setValueEditing(false);
    // scope state removed
    setPunchItems(job.punchList || []);
    setNewPunchText("");
    setActivityExpanded(false);
    setNotesExpanded(false);
    setActivity([]);
    // Comms section manages its own state via ProductionCommunicationSection.
  }, [job]);

  // Fetch recent activity for this job when the section is expanded.
  // Cheap (one GET) and rendered server-side from a single sheet read.
  useEffect(() => {
    if (!activityExpanded || !job.jobId) return;
    let cancelled = false;
    setActivityLoading(true);
    fetch(`/api/activity?jobId=${encodeURIComponent(job.jobId)}&limit=20`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setActivity(j.entries || []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityExpanded, job.jobId]);

  // Persist punch list — optimistic; server confirms on success.
  async function savePunch(next: PunchItem[]) {
    setPunchItems(next);
    await call("punch", { action: "punch", items: next });
  }
  function addPunchItem() {
    const text = newPunchText.trim();
    if (!text) return;
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const next = [...punchItems, { id, text, done: false }];
    setNewPunchText("");
    savePunch(next);
  }
  function togglePunch(id: string) {
    savePunch(punchItems.map((p) => (p.id === id ? { ...p, done: !p.done } : p)));
  }
  function removePunch(id: string) {
    savePunch(punchItems.filter((p) => p.id !== id));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  function flash(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2200);
  }

  async function call(name: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(name);
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash("err", j.error || "Action failed");
        return false;
      }
      flash("ok", "Saved");
      startTransition(() => router.refresh());
      return true;
    } catch {
      flash("err", "Network error");
      return false;
    } finally {
      setBusy(null);
    }
  }

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
                  {(() => {
                    const eff = effectiveStatus(job);
                    const cls =
                      eff === "Complete"
                        ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                        : eff === "In Production"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-slate-100 text-slate-700 border-slate-300";
                    return (
                      <span
                        className={cn(
                          "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border",
                          cls
                        )}
                      >
                        {eff}
                      </span>
                    );
                  })()}
                  <span
                    className={cn(
                      "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border",
                      job.movability === "Flexible" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                      job.movability === "Window" && "bg-purple-50 text-purple-700 border-purple-200",
                      job.movability === "Immovable" && "bg-rose-50 text-rose-700 border-rose-200"
                    )}
                  >
                    {job.movability === "Window" ? "Restrictions" : job.movability}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-text-primary truncate">{job.name}</h2>
                <div className="mt-1">
                  {valueEditing ? (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-cc-navy">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={valueDraft}
                        onChange={(e) => setValueDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const n = Number(valueDraft);
                            if (!Number.isFinite(n) || n < 0) {
                              flash("err", "Enter a valid amount");
                              return;
                            }
                            call("value", { action: "value", bookedValue: n }).then((ok) => {
                              if (ok) setValueEditing(false);
                            });
                          }
                          if (e.key === "Escape") {
                            setValueDraft(job.bookedValue > 0 ? String(Math.round(job.bookedValue)) : "");
                            setValueEditing(false);
                          }
                        }}
                        autoFocus
                        placeholder="0"
                        className="w-32 px-2 py-1 text-2xl font-bold text-cc-navy tabular-nums rounded-md border border-cc-accent focus:outline-none focus:ring-2 focus:ring-cc-accent"
                      />
                      <button
                        onClick={() => {
                          const n = Number(valueDraft);
                          if (!Number.isFinite(n) || n < 0) {
                            flash("err", "Enter a valid amount");
                            return;
                          }
                          call("value", { action: "value", bookedValue: n }).then((ok) => {
                            if (ok) setValueEditing(false);
                          });
                        }}
                        disabled={busy === "value" || isPending}
                        className="px-2.5 py-1 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50"
                      >
                        {busy === "value" ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setValueDraft(job.bookedValue > 0 ? String(Math.round(job.bookedValue)) : "");
                          setValueEditing(false);
                        }}
                        disabled={busy === "value"}
                        className="px-2.5 py-1 text-xs font-semibold text-text-secondary rounded-md hover:bg-zinc-100"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setValueEditing(true)}
                      className="group inline-flex items-center gap-1.5 text-2xl font-bold text-cc-navy tabular-nums hover:opacity-80 transition"
                      title="Click to edit booked value"
                    >
                      <span>{formatCurrency(job.bookedValue)}</span>
                      <Pencil className="w-3.5 h-3.5 text-text-muted opacity-50 group-hover:opacity-100 transition" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Status lifecycle buttons (per Jared 2026-05-12):
                    Scheduled → "In Production" → "Mark Complete"
                    - Scheduled: shows both "In Production" + "Mark Complete"
                    - In Production: shows "Mark Complete" + green active-state pill
                    - Complete: shows "Reopen"
                    "In Production" stops the next-touch communication logic
                    (handled in ProductionCommunicationSection — different
                    system takes over for daily on-job client comms). */}
                {job.status === "Complete" ? (
                  <button
                    onClick={() => call("status-reopen", { action: "status", status: "Scheduled" })}
                    disabled={busy !== null || isPending}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                    title="Reopen job (return to Scheduled)"
                  >
                    Reopen
                  </button>
                ) : (
                  <>
                    {job.status === "In Production" ? (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-amber-400 bg-amber-50 text-amber-900"
                        title="Job is currently in production — client comms handled outside this dashboard"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        In Production
                      </span>
                    ) : (
                      <button
                        onClick={() => call("status-inprogress", { action: "status", status: "In Production" })}
                        disabled={busy !== null || isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-amber-300 bg-white text-amber-800 hover:bg-amber-50 disabled:opacity-50 transition"
                        title="Mark job as In Production — ends auto next-touch comms (you and PM handle daily client comms during production)"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        {busy === "status-inprogress" ? "Saving…" : "In Production"}
                      </button>
                    )}
                    <button
                      onClick={() => call("status-complete", { action: "status", status: "Complete" })}
                      disabled={busy !== null || isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 transition"
                      title="Mark job as complete"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {busy === "status-complete" ? "Saving…" : "Mark Complete"}
                    </button>
                  </>
                )}
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 text-text-secondary" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Communication — moved to top 2026-05-10 per UX audit. This
                  is the daily-action surface for managing client comms
                  cadence per the SOP. Encapsulated in its own component
                  so it can be cleanly placed first. */}
              <ProductionCommunicationSection
                job={job}
                call={call}
                busy={busy}
                isPending={isPending}
              />

              {/* Summary — production-relevant client context. Pulled from the
                  [SUMMARY] block in the notes column. Front-and-centre and
                  always visible (not collapsed). Content rule: schedule
                  context + flexibility, informational colour notes, and
                  any other production-relevant context. NOT sales-stage
                  info like paint product chosen, pricing notes, deposit
                  status — those belong in DripJobs / notes, not the summary. */}
              {(() => {
                const parsed = parseSummary(job.notes || "");
                if (!parsed.hasSummary) return null;
                return (
                  <section className="bg-cc-accent-soft/40 border border-cc-accent/20 rounded-lg p-3 -mx-1 space-y-1.5">
                    <h3 className="text-xs uppercase tracking-wider font-bold text-cc-navy">
                      Summary
                    </h3>
                    {parsed.schedule && (
                      <div className="text-sm text-text-primary leading-snug">
                        <span className="font-bold mr-1.5" title="Schedule context + flexibility">📅</span>
                        <span>{parsed.schedule}</span>
                      </div>
                    )}
                    {parsed.colors && (
                      <div className="text-sm text-text-primary leading-snug">
                        <span className="font-bold mr-1.5" title="Colour info">🎨</span>
                        <span>{parsed.colors}</span>
                      </div>
                    )}
                    {parsed.important && (
                      <div className="text-sm text-text-primary leading-snug">
                        <span className="font-bold mr-1.5" title="Production notes">⚠️</span>
                        <span>{parsed.important}</span>
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* Schedule editor */}
              <section className="bg-zinc-50 -mx-5 px-5 py-4 border-y border-border space-y-3">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted">Schedule</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Crew</label>
                    <input
                      list="crew-list"
                      value={crewDraft}
                      onChange={(e) => setCrewDraft(e.target.value)}
                      placeholder="Crew name"
                      className="w-full px-2 py-1.5 text-sm rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                    <datalist id="crew-list">
                      {crews.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Est Hours</label>
                    <input
                      type="number"
                      value={estHoursDraft}
                      onChange={(e) => setEstHoursDraft(e.target.value)}
                      placeholder="e.g. 24"
                      className="w-full px-2 py-1.5 text-sm rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDraft}
                      onChange={(e) => setStartDraft(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDraft}
                      onChange={(e) => setEndDraft(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </div>
                </div>
                <button
                  onClick={() =>
                    call("schedule", {
                      action: "schedule",
                      crew: crewDraft,
                      startDate: startDraft,
                      endDate: endDraft,
                      estHours: estHoursDraft ? Number(estHoursDraft) : undefined,
                    })
                  }
                  disabled={busy === "schedule" || isPending}
                  className="px-3 py-1.5 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50"
                >
                  {busy === "schedule" ? "Saving…" : "Save schedule"}
                </button>
              </section>

              {/* Crew Status + Movability — paired 2-col grid for compact
                  paired button groups (matches the Wash + Colours row
                  below). Crew Status button sizing tightened to fit. */}
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Crew Status</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(["Not Offered", "Offered", "Confirmed"] as const).map((cs) => {
                      const isActive = cs === job.crewStatus;
                      const colors = isActive
                        ? cs === "Confirmed"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : cs === "Offered"
                            ? "bg-amber-500 text-white border-amber-500"
                            : "bg-slate-500 text-white border-slate-500"
                        : "bg-white text-text-secondary border-border hover:bg-zinc-50";
                      return (
                        <button
                          key={cs}
                          onClick={() => call(`cs-${cs}`, { action: "crewStatus", crewStatus: cs })}
                          disabled={busy !== null || isPending || isActive}
                          className={cn(
                            "text-[11px] font-semibold px-2 py-1 rounded-md border transition",
                            colors,
                            isActive && "cursor-default"
                          )}
                        >
                          {cs === "Confirmed" ? "✓ Confirmed" : cs === "Offered" ? "→ Offered" : "○ Not Offered"}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Movability</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(["Flexible", "Window", "Immovable"] as Movability[]).map((m) => {
                      const isCurrent = m === job.movability;
                      const label = m === "Window" ? "Restrictions" : m === "Immovable" ? "Do Not Move" : m;
                      const colors = isCurrent
                        ? m === "Flexible"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : m === "Window"
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-rose-600 text-white border-rose-600"
                        : "bg-white text-text-secondary border-border hover:bg-zinc-50";
                      return (
                        <button
                          key={m}
                          onClick={() => call(`mov-${m}`, { action: "movability", movability: m })}
                          disabled={busy !== null || isPending || isCurrent}
                          className={cn(
                            "text-[11px] font-semibold px-2 py-1 rounded-md border transition",
                            colors,
                            isCurrent && "cursor-default"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Wash + Colors status */}
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Washing</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["NA", "Not Scheduled", "Yes Scheduled", "Complete"] as const).map((w) => {
                      const isCurrent = w === job.washStatus;
                      const colors = isCurrent
                        ? w === "Complete"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : w === "Yes Scheduled"
                            ? "bg-sky-500 text-white border-sky-500"
                            : w === "Not Scheduled"
                              ? "bg-amber-500 text-white border-amber-500"
                              : "bg-zinc-500 text-white border-zinc-500"
                        : "bg-white text-text-secondary border-border hover:bg-zinc-50";
                      // Display label override: stored value stays "NA" but UI
                      // shows "Not Required" so it's self-explanatory.
                      const label = w === "NA" ? "Not Required" : w;
                      return (
                        <button
                          key={w}
                          onClick={() => call(`wash-${w}`, { action: "wash", status: w })}
                          disabled={busy !== null || isPending || isCurrent}
                          className={cn(
                            "text-[11px] font-semibold px-2 py-1 rounded-md border transition text-center",
                            colors,
                            isCurrent && "cursor-default"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {job.washDate && (
                    <p className="text-[10px] text-text-muted mt-1">Last updated {job.washDate}</p>
                  )}
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Colours</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["Match Required", "Sample Required", "Codes from Client", "Confirmed Colours"] as const).map((c) => {
                      const isCurrent = c === job.colorsStatus;
                      const colors = isCurrent
                        ? c === "Confirmed Colours"
                          ? "bg-violet-600 text-white border-violet-600"
                          : c === "Codes from Client"
                            ? "bg-sky-500 text-white border-sky-500"
                            : c === "Sample Required"
                              ? "bg-amber-500 text-white border-amber-500"
                              : "bg-rose-500 text-white border-rose-500"
                        : "bg-white text-text-secondary border-border hover:bg-zinc-50";
                      return (
                        <button
                          key={c}
                          onClick={() => call(`colors-${c}`, { action: "colors", status: c })}
                          disabled={busy !== null || isPending || isCurrent}
                          className={cn(
                            "text-[11px] font-semibold px-2 py-1 rounded-md border transition text-center",
                            colors,
                            isCurrent && "cursor-default"
                          )}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  {job.colorsDate && (
                    <p className="text-[10px] text-text-muted mt-1">Last updated {job.colorsDate}</p>
                  )}
                </div>
              </section>

              {/* Movability moved up to share a 2-col row with Crew Status
                  (2026-05-10). Status section removed earlier — Complete state
                  is handled by the header "Mark Complete" button; "In
                  Production" is auto-derived from dates. */}

              {/* Contact */}
              <section className="space-y-1.5 text-sm">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Contact</h3>
                {job.phone && (
                  <a href={`tel:${job.phone.replace(/\s+/g, "")}`} className="flex items-center gap-2 text-cc-blue hover:underline">
                    <Phone className="w-4 h-4" /> {job.phone}
                  </a>
                )}
                {job.email && (
                  <a href={`mailto:${job.email}`} className="flex items-center gap-2 text-cc-blue hover:underline">
                    <Mail className="w-4 h-4" /> {job.email}
                  </a>
                )}
                {job.address && (
                  <div className="flex items-start gap-2 text-text-secondary">
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0" /> <span>{job.address}</span>
                  </div>
                )}
              </section>


              {/* Scope / Crew Brief — REMOVED 2026-05-10 per audit. DripJobs
                  already sends a detailed work order to subs; duplicating
                  that here created dual entry. Column AC on the sheet
                  preserved (no harm) but no UI surface. */}

              {/* To-Do List — internal checklist. Used to be called
                  "Punch List" with iCal-feed integration, but per Jared
                  (2026-05-10) subs get their work orders through DripJobs,
                  not via dashboard feeds. This is now strictly internal —
                  Jared / PM track production-day items here. */}
              <section className="bg-white border border-border rounded-lg p-3 -mx-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" />
                    To-Do List
                    {punchItems.length > 0 && (
                      <span className="text-[10px] font-bold tabular-nums text-text-secondary">
                        {punchItems.filter((p) => p.done).length}/{punchItems.length}
                      </span>
                    )}
                  </h3>
                  <span className="text-[10px] text-text-muted italic">Internal — for Jared / PM tracking</span>
                </div>
                {punchItems.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {punchItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start gap-2 group bg-zinc-50 border border-border rounded-md px-2 py-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() => togglePunch(item.id)}
                          className="mt-0.5 w-4 h-4 accent-emerald-600 cursor-pointer shrink-0"
                          aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                        />
                        <span
                          className={cn(
                            "flex-1 text-sm leading-snug",
                            item.done ? "line-through text-text-muted" : "text-text-primary"
                          )}
                        >
                          {item.text}
                        </span>
                        <button
                          onClick={() => removePunch(item.id)}
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
                    value={newPunchText}
                    onChange={(e) => setNewPunchText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPunchItem();
                      }
                    }}
                    placeholder="Add a to-do (e.g. touch up dining ceiling)"
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                  />
                  <button
                    onClick={addPunchItem}
                    disabled={!newPunchText.trim() || busy === "punch"}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </section>

              {/* Auto-confirm toggle SHELVED 2026-05-10 — CC doesn't
                  promise dates until a few days before the job. Toggle
                  removed pending the proper pre-production communication
                  sequence redesign. Schema (job.autoConfirm,
                  job.confirmationSentDate) preserved on the type + sheet
                  for the rebuild. Component code in
                  components/ConfirmationBanner.tsx kept as scaffolding. */}

              {/* Summary moved to top of drawer 2026-05-10 — front-and-centre
                  per Jared's audit. Always visible (not collapsed). */}

              {/* Notes — running timestamped log. Collapsed by default; expand
                  to add a note or read the running journal. Stripped of the
                  booking [SUMMARY] block (that's in Booking Context above). */}
              {(() => {
                const stripped = stripSummary(job.notes || "").trim();
                const hasNotes = stripped.length > 0;
                return (
                  <section className="bg-white border border-border rounded-lg p-3 -mx-1">
                    <button
                      onClick={() => setNotesExpanded((v) => !v)}
                      className="flex items-center justify-between w-full text-left group"
                    >
                      <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted">
                        Notes
                      </h3>
                      <span className="text-[11px] text-text-muted group-hover:text-text-primary">
                        {notesExpanded ? "Hide" : hasNotes ? "Show" : "Add"}
                      </span>
                    </button>
                    {notesExpanded && (
                      <div className="mt-2">
                        <textarea
                          rows={3}
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add a note (timestamped, prepended to existing notes)..."
                          className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                        />
                        <button
                          onClick={async () => {
                            const ok = await call("note", { action: "note", text: noteText });
                            if (ok) setNoteText("");
                          }}
                          disabled={!noteText.trim() || busy !== null || isPending}
                          className="mt-2 px-3 py-1.5 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50"
                        >
                          Add note
                        </button>
                        {hasNotes && (
                          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-text-primary leading-relaxed bg-zinc-50 border border-border rounded-lg p-3">
                            {stripped}
                          </pre>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* Activity log — lazy-loaded on expand. Surfaces last 20
                  events for this job (who changed what, when). Critical
                  when 2nd user (Brad/Giancarlo) onboards to answer
                  "who moved this?" without slacking. */}
              <section>
                <button
                  onClick={() => setActivityExpanded((v) => !v)}
                  className="flex items-center justify-between w-full text-left group"
                >
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Recent Activity
                  </h3>
                  <span className="text-[11px] text-text-muted group-hover:text-text-primary">
                    {activityExpanded ? "Hide" : "Show"}
                  </span>
                </button>
                {activityExpanded && (
                  <div className="mt-2">
                    {activityLoading && (
                      <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading…
                      </div>
                    )}
                    {!activityLoading && activity.length === 0 && (
                      <div className="text-xs text-text-muted italic py-2">
                        No activity yet for this job.
                      </div>
                    )}
                    {!activityLoading && activity.length > 0 && (
                      <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
                        {activity.map((e, i) => (
                          <li
                            key={i}
                            className="text-xs bg-zinc-50 border border-border rounded-md px-2.5 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-text-primary">
                                {e.action}
                              </span>
                              <span className="text-text-muted tabular-nums shrink-0">
                                {formatActivityTime(e.timestamp)}
                              </span>
                            </div>
                            <div className="text-text-secondary mt-0.5 leading-snug">
                              {e.detail}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {/* Danger zone — Delete job. Permanently clears the row in
                  the Production sheet (logged to System Activity first
                  for audit trail). Confirm prompt prevents accidental
                  taps. Per Jared 2026-05-12. */}
              <section className="mt-8 pt-4 border-t border-rose-200">
                <div className="text-[10px] uppercase tracking-wider font-bold text-rose-600/70 mb-2">
                  Danger zone
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = window.confirm(
                      `Delete job "${job.name}" permanently?\n\nThis clears the row in the Production sheet. Use Mark Complete instead if the job was finished — Delete is for accidentally-added rows or cleanup.\n\nThis cannot be undone from the dashboard. You'd have to manually re-add the row in the sheet.`
                    );
                    if (!ok) return;
                    setBusy("delete");
                    try {
                      const res = await fetch("/api/production", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "delete", jobId: job.jobId }),
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => ({}));
                        setToast({ text: j.error || "Delete failed", kind: "err" });
                        return;
                      }
                      setToast({ text: `Deleted ${job.name}`, kind: "ok" });
                      startTransition(() => router.refresh());
                      // Close drawer after a tick so the toast briefly shows
                      setTimeout(() => onClose(), 700);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  disabled={busy !== null || isPending}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition"
                  title="Permanently delete this job from the Production sheet"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {busy === "delete" ? "Deleting…" : "Delete job"}
                </button>
                <span className="ml-2 text-[10px] text-text-muted">
                  Use Mark Complete to finish a job — Delete is for accidentally-added rows
                </span>
              </section>
            </div>
          </motion.aside>

          {toast && (
            <div
              className={cn(
                "fixed bottom-6 right-6 z-[60] px-4 py-2 rounded-lg shadow-xl text-sm font-medium",
                toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
              )}
            >
              {toast.kind === "ok" ? "✓ " : "⚠ "}
              {toast.text}
            </div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}

/** Parse a [SUMMARY]...[/SUMMARY] block out of the notes column.
 *  Format inside the block:
 *    SCHEDULE: <text>
 *    COLOURS: <text>
 *    NOTES: <text>
 *  Each on its own line. Missing lines fall through. */
function parseSummary(notes: string): {
  hasSummary: boolean;
  schedule?: string;
  colors?: string;
  important?: string;
} {
  const m = notes.match(/\[SUMMARY\]([\s\S]*?)\[\/SUMMARY\]/);
  if (!m) return { hasSummary: false };
  const block = m[1];
  const get = (label: string) => {
    const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
    const mm = block.match(re);
    return mm ? mm[1].trim() : undefined;
  };
  return {
    hasSummary: true,
    schedule: get("SCHEDULE"),
    colors: get("COLOU?RS"),
    important: get("NOTES") || get("IMPORTANT"),
  };
}

/** Strip the [SUMMARY]...[/SUMMARY] block when displaying the full notes
 *  body, so the same content doesn't render twice. */
// Compact format for activity timestamps in the drawer. Today: "3:42pm".
// Yesterday: "Yesterday 3:42pm". Older: "May 8 3:42pm". Input is ISO-ish
// "YYYY-MM-DDTHH:MM:SS" in Vancouver time.
function formatActivityTime(ts: string): string {
  if (!ts) return "";
  const [datePart, timePart] = ts.split("T");
  if (!datePart || !timePart) return ts;
  const [hh, mm] = timePart.split(":");
  const h = parseInt(hh, 10);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${h12}:${mm}${period}`;
  const today = todayISO();
  if (datePart === today) return time;
  const y = new Date(today + "T12:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  if (datePart === yesterday) return `Yesterday ${time}`;
  const d = new Date(datePart + "T12:00:00Z");
  const month = d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${month} ${time}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function formatRelativePast(iso: string): string {
  const today = todayISO();
  const d = daysBetween(iso, today);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 0) return `In ${Math.abs(d)}d`;
  if (d <= 7) return `${d}d ago`;
  if (d <= 14) return `${d}d ago`;
  if (d <= 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function formatRelativeFuture(iso: string): string {
  const today = todayISO();
  const d = daysBetween(today, iso);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d <= 14) return `In ${d}d`;
  if (d <= 60) return `In ${Math.round(d / 7)}w`;
  return `In ${Math.round(d / 30)}mo`;
}

function stripSummary(notes: string): string {
  return notes.replace(/\[SUMMARY\][\s\S]*?\[\/SUMMARY\]\s*/, "").trim();
}

