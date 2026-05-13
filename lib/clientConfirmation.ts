import type { ProductionJob } from "./types";

/**
 * Client auto-confirmation email composer.
 *
 * Voice rules from email-drafting-cc skill (validated against 115+ of
 * Jared's real CC emails Jan-May 2026):
 *  - "Hey [first name]," for scheduling confirmations (Sample 10 register)
 *  - Short — 2-3 sentence body max
 *  - Conversational, hedged, no urgency, no pressure
 *  - First-person, full sentences ("I'll be there" not "Will be there")
 *  - Sign-off: "See you soon," for scheduling confirmations
 *  - No em dashes, no AI filler ("kindly", "merely", "ensure")
 *
 * The recipient already booked. This is a quick "confirming the dates"
 * touch — not a sales pitch, not a checklist dump.
 */

interface ConfirmationEmail {
  subject: string;
  body: string;
}

export function buildConfirmationEmail(job: ProductionJob): ConfirmationEmail {
  const firstName = (job.name || "").split(/\s+/)[0] || "there";
  const start = job.startDate ? formatLongDate(job.startDate) : null;
  const end = job.endDate && job.endDate !== job.startDate ? formatLongDate(job.endDate) : null;

  // Date phrase — handles 1-day vs multi-day cleanly.
  let datePhrase = "";
  if (start && end) {
    datePhrase = `starting ${start} and wrapping up by ${end}`;
  } else if (start) {
    datePhrase = `on ${start}`;
  } else {
    datePhrase = "for the dates we discussed";
  }

  // Contextual prep mention — only one beat, only if there's a real "to do".
  let prepBeat = "";
  if (job.washStatus === "Yes Scheduled" && job.washDate) {
    prepBeat = `\n\nThe wash is scheduled for ${formatLongDate(job.washDate)}, so the crew can hit the ground running on day one.`;
  } else if (job.colorsStatus === "Sample Required" || job.colorsStatus === "Codes from Client" || job.colorsStatus === "Match Required") {
    prepBeat = `\n\nQuick heads up: we're still finalizing colours on our end. If anything's shifted on what you'd like, just let me know before we start.`;
  }

  const subject = `Confirming your painting${start ? ` — ${start}` : ""}`;

  const body = [
    `Hey ${firstName},`,
    ``,
    `Just confirming we're scheduled ${datePhrase}.${prepBeat}`,
    ``,
    `If anything has changed on your end or there's anything specific you'd like the crew to know, just give me a shout.`,
    ``,
    `See you soon,`,
    `Jared`,
  ].join("\n");

  return { subject, body };
}

/**
 * Build a Gmail compose URL — opens Gmail in a new tab with the message
 * pre-filled. Jared reviews, hits Send. No backend integration needed
 * for v1. Future v2: domain-wide-delegation service account auto-sends.
 */
export function buildGmailComposeUrl(email: string, subject: string, body: string): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: email,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Eligibility — a job appears in the confirmation banner when:
 *  - crewStatus is "Confirmed" (we wouldn't confirm an unbooked-with-crew job)
 *  - autoConfirm flag is true
 *  - email is set (nothing to send to otherwise)
 *  - startDate is set and within HOURS_AHEAD window (default 72)
 *  - confirmationSentDate is empty OR older than 7 days
 *    (allows re-send if date changed significantly)
 */
const HOURS_AHEAD = 72;

export function isEligibleForConfirmation(job: ProductionJob, todayISO: string): boolean {
  if (!job.autoConfirm) return false;
  if (job.crewStatus !== "Confirmed") return false;
  if (!job.email) return false;
  if (!job.startDate) return false;
  // Within HOURS_AHEAD window — start date is today through today + 3 days.
  const today = new Date(todayISO + "T12:00:00Z");
  const start = new Date(job.startDate + "T12:00:00Z");
  const hoursUntilStart = (start.getTime() - today.getTime()) / 3_600_000;
  if (hoursUntilStart < 0 || hoursUntilStart > HOURS_AHEAD + 24) return false;
  // Skip if already sent within last 7 days.
  if (job.confirmationSentDate) {
    const sent = new Date(job.confirmationSentDate + "T12:00:00Z");
    const daysSinceSent = (today.getTime() - sent.getTime()) / 86_400_000;
    if (daysSinceSent < 7) return false;
  }
  return true;
}

function formatLongDate(iso: string): string {
  // "Monday, May 12" — no year (within current planning horizon, year is implied).
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
