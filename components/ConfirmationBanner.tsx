"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, ExternalLink, X, Check } from "lucide-react";
import type { ProductionJob } from "@/lib/types";
import {
  buildConfirmationEmail,
  buildGmailComposeUrl,
  isEligibleForConfirmation,
} from "@/lib/clientConfirmation";
import { todayISO } from "@/lib/utils";

interface Props {
  jobs: ProductionJob[];
}

/**
 * Surfaces jobs that need client confirmation: crewStatus Confirmed +
 * start within 72hr + autoConfirm on + email set + not already sent.
 *
 * Per job, "Open in Gmail" pre-fills a draft in Jared's CC voice (Sample
 * 10 register — quick scheduling confirmation). On click, we mark the
 * confirmation as sent so the job disappears from the banner. Jared still
 * has to hit Send in Gmail — that's intentional v1 (he reviews every
 * outbound to a client). v2 will auto-send via service-account DWD.
 */
export function ConfirmationBanner({ jobs }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = todayISO();
  const eligible = useMemo(
    () => jobs.filter((j) => isEligibleForConfirmation(j, today)),
    [jobs, today]
  );

  if (dismissed || eligible.length === 0) return null;

  async function handleSend(job: ProductionJob) {
    setBusyId(job.jobId);
    const { subject, body } = buildConfirmationEmail(job);
    const url = buildGmailComposeUrl(job.email, subject, body);
    // Open Gmail compose in a new tab. The browser's popup blocker usually
    // allows this since it's a direct response to user click.
    window.open(url, "_blank", "noopener");
    // Optimistically mark sent — server confirms via the route.
    try {
      await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirmationSent", jobId: job.jobId }),
      });
      startTransition(() => router.refresh());
    } catch {
      // Silent — if logging the send fails the banner just stays. User
      // can re-click. Not catastrophic.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="bg-cc-accent-soft/60 border border-cc-accent/40 rounded-2xl px-4 py-3"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="w-4 h-4 text-cc-accent shrink-0" />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-cc-navy font-bold">
                Client confirmations ready
              </div>
              <div className="text-xs text-text-secondary leading-snug">
                {eligible.length} job{eligible.length === 1 ? "" : "s"} confirmed with start within
                72 hours. Draft opens in Gmail — review and send.
              </div>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-text-muted hover:text-text-primary shrink-0 -mt-0.5"
            aria-label="Dismiss"
            title="Dismiss (will reappear on refresh)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-1.5">
          {eligible.map((job) => (
            <li
              key={job.jobId}
              className="flex items-center justify-between gap-3 bg-white border border-cc-accent/20 rounded-lg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text-primary truncate">
                  {job.name}
                </div>
                <div className="text-xs text-text-muted truncate">
                  {job.startDate}
                  {job.endDate && job.endDate !== job.startDate ? ` → ${job.endDate}` : ""}
                  {" · "}
                  {job.email}
                </div>
              </div>
              <button
                onClick={() => handleSend(job)}
                disabled={busyId === job.jobId}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50 transition-colors shrink-0"
              >
                {busyId === job.jobId ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )}
                {busyId === job.jobId ? "Marking sent…" : "Open in Gmail"}
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  );
}
