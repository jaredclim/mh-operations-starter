"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, ExternalLink, Phone, Mail, MapPin, Calendar, MessageSquare, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import type { ScoredLead } from "@/lib/types";
import { leadsCommsState, leadsPhase, suggestedNextLeadTouchDate } from "@/lib/leadsCadence";
import { LeadDrawerActions } from "./LeadDrawerActions";

interface Props {
  lead: ScoredLead;
  open: boolean;
  onClose: () => void;
}

/**
 * Lead detail drawer. Mirrors OppDrawer's structure for visual consistency
 * but is built around pre-estimate concerns:
 *   - Cadence chip at top
 *   - Quick-log row + stage controls
 *   - Setup call toggle (on Estimate booked)
 *   - Reschedule action (on Estimate booked)
 *   - Long-term hold reach-out date (when applicable)
 *   - Lost reason picklist
 *   - Notes (timestamped, append-only)
 *   - Recent activity (audit log)
 */
export function LeadDrawer({ lead, open, onClose }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [openSections, setOpenSections] = useState({ notes: true, contact: true, activity: false });
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const today = todayISO();
  const comms = leadsCommsState(lead);
  const phase = leadsPhase(lead);

  async function saveNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, action: "note", text: noteText }),
      });
      setNoteText("");
      startTransition(() => router.refresh());
    } finally {
      setSavingNote(false);
    }
  }

  const severityBar =
    comms.level === "rose"
      ? "bg-rose-500"
      : comms.level === "amber"
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-border">
          <div className={cn("h-1", severityBar)} />
          <div className="px-5 sm:px-6 py-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-text-primary truncate">{lead.name}</h2>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-cc-navy text-white">
                  {lead.stage}
                </span>
                {lead.leadSource && (
                  <span className="text-[11px] text-text-muted">{lead.leadSource}</span>
                )}
                {lead.stage === "Estimate booked" && (
                  <span
                    className={cn(
                      "inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border",
                      lead.setupCallDone
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    )}
                  >
                    {lead.setupCallDone ? "✓ Setup done" : "⚠ Setup pending"}
                  </span>
                )}
                {lead.rescheduleCount >= 1 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                    <RefreshCw className="w-2.5 h-2.5" />
                    {lead.rescheduleCount}x rescheduled
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5">
          {/* Communication state — top of drawer */}
          <section className="bg-gradient-to-br from-zinc-50 to-white border border-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full",
                    comms.level === "rose"
                      ? "bg-rose-100 text-rose-800"
                      : comms.level === "amber"
                        ? "bg-amber-100 text-amber-800"
                        : comms.level === "green"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-zinc-100 text-zinc-700"
                  )}
                >
                  {comms.label}
                </span>
                <span className="text-xs text-text-secondary">{phase.label}</span>
              </div>
            </div>
            <p className="text-[13px] text-text-secondary leading-snug">{phase.guidance}</p>
            {lead.priorityReasons.length > 0 && lead.priorityScore >= 500 && (
              <div className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-rose-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                {lead.priorityReasons[0]}
              </div>
            )}
          </section>

          {/* Stage controls + Quick log + Lost */}
          <LeadDrawerActions lead={lead} onClose={onClose} />

          {/* Field grid — pre-estimate facts at a glance */}
          <section className="grid grid-cols-2 gap-3 text-[13px]">
            {lead.stage === "Callback requested" && lead.callbackTime && (
              <Field label="Callback at" value={lead.callbackTime} highlight />
            )}
            {lead.stage === "Estimate booked" && lead.estimateVisitDate && (
              <Field label="Estimate visit" value={lead.estimateVisitDate} highlight />
            )}
            {lead.originalEstimateDate && lead.rescheduleCount >= 1 && (
              <Field label="Originally booked" value={lead.originalEstimateDate} />
            )}
            {lead.stage === "Long-term hold" && lead.longTermReachOutDate && (
              <Field label="Reach out by" value={lead.longTermReachOutDate} highlight />
            )}
            {lead.firstInquiryDate && (
              <Field label="First inquiry" value={lead.firstInquiryDate} />
            )}
            {lead.stage === "Attempted contact" && (
              <Field label="Attempts" value={String(lead.contactAttempts)} />
            )}
            {lead.lastTouchDate && (
              <Field label="Last touch" value={`${lead.lastTouchDate}${lead.lastTouchType ? ` · ${lead.lastTouchType}` : ""}`} />
            )}
            {lead.nextTouchDate && (
              <Field label="Next touch" value={`${lead.nextTouchDate}${lead.nextTouchType ? ` · ${lead.nextTouchType}` : ""}`} />
            )}
          </section>

          {/* Contact */}
          <Section
            label="Contact"
            isOpen={openSections.contact}
            onToggle={() => setOpenSections((s) => ({ ...s, contact: !s.contact }))}
          >
            <div className="space-y-1.5 text-sm">
              {lead.phone && (
                <ContactRow icon={<Phone className="w-3.5 h-3.5" />} label={lead.phone} href={`tel:${lead.phone.replace(/\s/g, "")}`} />
              )}
              {lead.email && (
                <ContactRow icon={<Mail className="w-3.5 h-3.5" />} label={lead.email} href={`mailto:${lead.email}`} />
              )}
              {lead.address && (
                <ContactRow
                  icon={<MapPin className="w-3.5 h-3.5" />}
                  label={lead.address}
                  href={`https://maps.google.com/?q=${encodeURIComponent(lead.address)}`}
                />
              )}
              {lead.dripJobsLink && (
                <ContactRow icon={<ExternalLink className="w-3.5 h-3.5" />} label="Open in DripJobs" href={lead.dripJobsLink} />
              )}
              {!lead.phone && !lead.email && !lead.address && (
                <div className="text-text-muted italic">No contact info on file.</div>
              )}
            </div>
          </Section>

          {/* Notes */}
          <Section
            label="Notes"
            isOpen={openSections.notes}
            onToggle={() => setOpenSections((s) => ({ ...s, notes: !s.notes }))}
          >
            <div className="space-y-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a timestamped note…"
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-cc-accent resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!noteText.trim() || savingNote}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-cc-navy text-white rounded-md hover:bg-cc-navy-deep disabled:opacity-50 transition"
                >
                  {savingNote ? "Saving…" : "Add note"}
                </button>
              </div>
              {lead.notes ? (
                <div className="mt-2 text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed bg-zinc-50 border border-border rounded-lg p-3 max-h-64 overflow-y-auto">
                  {lead.notes}
                </div>
              ) : (
                <div className="text-text-muted italic text-sm">No notes yet.</div>
              )}
            </div>
          </Section>

          {/* Stale signals */}
          {lead.staleSignals.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-2">
                Signals
              </div>
              <div className="space-y-1.5">
                {lead.staleSignals.map((sig, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 text-[13px] px-3 py-2 rounded-lg border",
                      sig.severity === "rose"
                        ? "bg-rose-50 border-rose-200 text-rose-900"
                        : "bg-amber-50 border-amber-200 text-amber-900"
                    )}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold">{sig.label}</div>
                      <div className="text-[12px] opacity-80">{sig.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("border border-border rounded-lg px-3 py-2", highlight && "bg-cc-accent/5 border-cc-accent/30")}>
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">{label}</div>
      <div className={cn("font-medium tabular-nums", highlight ? "text-cc-navy" : "text-text-primary")}>{value}</div>
    </div>
  );
}

function ContactRow({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="flex items-center gap-2 text-text-secondary hover:text-cc-navy transition"
    >
      <span className="text-cc-accent">{icon}</span>
      <span className="truncate">{label}</span>
    </a>
  );
}

function Section({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-2 hover:text-text-primary"
      >
        <span>{label}</span>
        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {isOpen && children}
    </section>
  );
}
