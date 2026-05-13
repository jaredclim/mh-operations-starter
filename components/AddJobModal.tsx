"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Loader2 } from "lucide-react";
import { cn, parseCurrency } from "@/lib/utils";
import type { Movability, ProductionJob } from "@/lib/types";

interface Props {
  jobs: ProductionJob[];
  crews: string[];
  // Optional controlled-mode props. When provided, parent owns the open
  // state and can pre-fill crew + startDate (used by the empty-cell
  // click-to-add affordance on the production grid). When omitted, the
  // modal renders its own "Add Job" trigger button and manages its own
  // state (existing toolbar behavior).
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialCrew?: string;
  initialStartDate?: string;
  hideTriggerButton?: boolean;
}

/**
 * Add Job modal — manual creation path for jobs that didn't come through
 * the Pipeline → Mark Won flow. Used by Jared and (eventually) PM /
 * partners to add jobs they booked outside the lead pipeline (e.g.,
 * referrals, repeat customers, partner referrals). Required: name +
 * booked value. Everything else optional — sensible defaults applied.
 */
export function AddJobModal({
  jobs,
  crews,
  controlledOpen,
  onOpenChange,
  initialCrew,
  initialStartDate,
  hideTriggerButton = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [bookedValueRaw, setBookedValueRaw] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [crew, setCrew] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [estHours, setEstHours] = useState("");
  const [movability, setMovability] = useState<Movability>("Flexible");
  const [scope, setScope] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setName("");
    setBookedValueRaw("");
    setPhone("");
    setEmail("");
    setAddress("");
    setCrew("");
    setStartDate("");
    setEndDate("");
    setEstHours("");
    setMovability("Flexible");
    setScope("");
    setNotes("");
    setErr(null);
  }

  function nextJobId(): string {
    const max = jobs
      .map((j) => j.jobId)
      .filter((id) => /^P\d+$/i.test(id))
      .map((id) => parseInt(id.slice(1), 10))
      .reduce((m, n) => Math.max(m, n), 0);
    return `P${String(max + 1).padStart(2, "0")}`;
  }

  // Esc to close + lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When opened with prefill (controlled mode from empty-cell click),
  // populate crew + startDate from the props. Wrapped in a useEffect so
  // it runs once per open-transition and doesn't clobber user edits.
  useEffect(() => {
    if (open && initialCrew) setCrew(initialCrew);
    if (open && initialStartDate) setStartDate(initialStartDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCrew, initialStartDate]);

  async function submit() {
    setErr(null);
    if (!name.trim()) {
      setErr("Client name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        action: "create",
        jobId: nextJobId(),
        name: name.trim(),
      };
      const bv = parseCurrency(bookedValueRaw);
      if (bv > 0) body.bookedValue = bv;
      if (phone.trim()) body.phone = phone.trim();
      if (email.trim()) body.email = email.trim();
      if (address.trim()) body.address = address.trim();
      if (crew.trim()) body.crew = crew.trim();
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
      const hrs = Number(estHours);
      if (Number.isFinite(hrs) && hrs > 0) body.estHours = hrs;
      body.movability = movability;
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `server ${res.status}`);
      }
      // If user filled scope or notes, send a follow-up call (the create
      // action doesn't accept scope/notes directly).
      if (scope.trim()) {
        await fetch("/api/production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: body.jobId, action: "scope", scope: scope.trim() }),
        });
      }
      if (notes.trim()) {
        await fetch("/api/production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: body.jobId, action: "note", text: notes.trim() }),
        });
      }
      reset();
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!hideTriggerButton && (
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1.5 text-xs font-bold rounded-md bg-cc-accent text-white border border-cc-accent shadow-sm hover:bg-cc-accent/90 inline-flex items-center gap-1.5 transition-all"
          title="Add a new job to production schedule"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Job
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[55]"
              onClick={() => !submitting && setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-x-4 top-12 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-16 sm:w-full sm:max-w-xl bg-surface rounded-2xl shadow-2xl z-[60] max-h-[calc(100vh-6rem)] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-text-primary">Add Job</h2>
                <button
                  onClick={() => !submitting && setOpen(false)}
                  className="p-1.5 rounded-md hover:bg-zinc-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                <Field label="Client name *" required>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Lisa Colby"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Booked value (incl. tax)">
                    <input
                      type="text"
                      value={bookedValueRaw}
                      onChange={(e) => setBookedValueRaw(e.target.value)}
                      placeholder="$8,500"
                      inputMode="decimal"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                  <Field label="Estimated hours">
                    <input
                      type="number"
                      value={estHours}
                      onChange={(e) => setEstHours(e.target.value)}
                      placeholder="auto: bookedValue / 100"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Phone">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(604) 123-4567"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="client@example.com"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                </div>

                <Field label="Address">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Steveston Hwy, Richmond, BC"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Crew">
                    <select
                      value={crew}
                      onChange={(e) => setCrew(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    >
                      <option value="">Unassigned</option>
                      {crews.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Start date">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                  <Field label="End date">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                    />
                  </Field>
                </div>

                <Field label="Movability">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(["Flexible", "Window", "Immovable"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMovability(m)}
                        className={cn(
                          "text-[11px] font-semibold px-3 py-1.5 rounded-md border transition",
                          movability === m
                            ? m === "Flexible"
                              ? "bg-emerald-500 text-white border-emerald-600"
                              : m === "Window"
                                ? "bg-purple-500 text-white border-purple-600"
                                : "bg-rose-500 text-white border-rose-600"
                            : "bg-white border-border text-text-secondary hover:bg-zinc-50"
                        )}
                      >
                        {m === "Flexible" ? "Flexible" : m === "Window" ? "Restrictions" : "Do Not Move"}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Scope (optional — what's being painted)">
                  <textarea
                    rows={2}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="Full exterior, trim + doors, deck stain"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                  />
                </Field>

                <Field label="Initial notes (optional)">
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Color match. Available May/June. Wife is Sarah."
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-white focus:outline-none focus:ring-2 focus:ring-cc-accent"
                  />
                </Field>

                {err && (
                  <div className="px-3 py-2 text-sm rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                    {err}
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-3 flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="px-3 py-1.5 text-sm font-semibold rounded-md border border-border bg-white hover:bg-zinc-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={submitting || !name.trim()}
                  className="px-4 py-1.5 text-sm font-bold rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add Job
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
