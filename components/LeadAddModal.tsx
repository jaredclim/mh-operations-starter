"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEAD_SOURCES, LEAD_STAGES } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Manual "add a lead" modal. Most leads flow in via DripJobs paste-in
 * or the briefing automation, but this exists for manual entry (e.g.
 * a referral that came in by text).
 */
export function LeadAddModal({ open, onClose }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    leadSource: "Referral" as string,
    stage: "New" as "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold",
    notes: "",
    dripJobsLink: "",
  });

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...form }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error || "Failed to create lead.");
        return;
      }
      setForm({
        name: "",
        phone: "",
        email: "",
        address: "",
        leadSource: "Referral",
        stage: "New",
        notes: "",
        dripJobsLink: "",
      });
      startTransition(() => router.refresh());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-border overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-cc-navy text-white">
          <h2 className="text-base font-bold">Add a lead</h2>
          <button type="button" onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Name *">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
              placeholder="Jane Doe"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                placeholder="604-555-0100"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
                placeholder="jane@example.com"
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
              placeholder="123 Main St, Richmond"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lead Source">
              <select
                value={form.leadSource}
                onChange={(e) => setForm((f) => ({ ...f, leadSource: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent bg-white"
              >
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stage">
              <select
                value={form.stage}
                onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as typeof form.stage }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent bg-white"
              >
                {LEAD_STAGES.filter((s) => s !== "Lost").map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
              placeholder="What did they say?"
              rows={3}
            />
          </Field>
          <Field label="DripJobs Link (optional)">
            <input
              type="url"
              value={form.dripJobsLink}
              onChange={(e) => setForm((f) => ({ ...f, dripJobsLink: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent"
              placeholder="https://app.dripjobs.com/…"
            />
          </Field>
          {err && <div className="text-sm text-cc-danger">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-border bg-zinc-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep transition disabled:opacity-50"
            )}
          >
            {busy ? "Adding…" : "Add lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
