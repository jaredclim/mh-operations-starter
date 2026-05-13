"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Sparkles, Plus, Upload } from "lucide-react";
import { LeadAddModal } from "./LeadAddModal";
import { LeadBulkImportModal } from "./LeadBulkImportModal";

/**
 * Empty state for the Leads dashboard. Shown when the Leads tab is empty
 * (or doesn't exist yet — fetchLeads returns [] in both cases).
 * Provides a one-click "Initialise" button that creates the Leads tab
 * with the proper 25-column header.
 */
export function LeadsInitNotice() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  async function init() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init" }),
      });
      const json = await res.json();
      if (json.ok) {
        setMsg(json.result?.created ? "Leads tab created ✓" : "Leads tab already exists ✓");
        startTransition(() => router.refresh());
      } else {
        setMsg(json.error || "Failed to initialise.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="bg-surface border border-border rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-cc-accent/15 text-cc-accent mb-3">
          <Sparkles className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">
          Leads dashboard ready to start
        </h2>
        <p className="text-sm text-text-secondary max-w-md mx-auto mb-5">
          This is the pre-estimate pipeline. New inquiries, attempted contacts, callback requests, and estimate-booked leads live here.
          When you add an opportunity to the Pipeline (via paste handoff), the matching lead auto-archives from here.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <button
            type="button"
            onClick={init}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-cc-navy text-white rounded-lg hover:bg-cc-navy-deep transition disabled:opacity-50"
          >
            {busy ? "Initialising…" : "Initialise Leads tab"}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-white border border-border rounded-lg hover:bg-zinc-50 hover:border-cc-accent/40 transition"
          >
            <Upload className="w-4 h-4" />
            Bulk import from CSV
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-white border border-border rounded-lg hover:bg-zinc-50 transition"
          >
            <Plus className="w-4 h-4" />
            Add a lead
          </button>
        </div>
        {msg && <div className="mt-3 text-sm text-text-secondary">{msg}</div>}
      </section>
      <LeadAddModal open={addOpen} onClose={() => setAddOpen(false)} />
      <LeadBulkImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
