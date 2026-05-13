/**
 * iCalendar (RFC 5545) feed generation. One feed per crew so subs can
 * subscribe once in their calendar app and have all their jobs appear
 * with start/end dates, address, and a CC Production link back to the
 * dashboard for full context.
 *
 * Why iCal over Google Calendar API integration:
 *  - Standard format works in Apple Calendar, Google Calendar, Outlook
 *  - No OAuth dance — one URL = one subscription
 *  - Read-only by design (subs can't accidentally mutate jobs from cal)
 *  - Auto-refreshes on the cal app's schedule (Apple Cal: every 15 min)
 */

import type { ProductionJob } from "./types";

function fmtICalDate(iso: string): string {
  // YYYY-MM-DD → YYYYMMDD (all-day events)
  return iso.replace(/-/g, "");
}

function fmtICalTimestamp(d: Date): string {
  // YYYYMMDDTHHmmssZ
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICalText(s: string): string {
  // RFC 5545: escape backslash, semicolon, comma, newline
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function foldLine(line: string): string {
  // RFC 5545: lines must not exceed 75 octets — fold long lines with
  // CRLF + space continuation.
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    out.push(i === 0 ? chunk : " " + chunk);
    i += i === 0 ? 75 : 74;
  }
  return out.join("\r\n");
}

export function buildCrewICal(crew: string, jobs: ProductionJob[], _baseUrl: string): string {
  // Privacy / IC-relationship guard rails:
  //  1. Filter to crewStatus === "Confirmed" only. Tentative placements
  //     (Not Offered / Offered) stay invisible to the sub — they don't
  //     get jobs put on their calendar until they've actively accepted.
  //  2. Notes are stripped entirely. Subs get dates / address / scope /
  //     wash + colors status — operational info they need on-site, not
  //     Jared's internal planning notes.
  //  3. Full-day events with no time-of-day. The sub controls their
  //     working hours within the agreed date span — Jared communicates
  //     dates, not shifts. This matches the IC-relationship structure in
  //     the sub working agreement.
  jobs = jobs.filter((j) => j.crewStatus === "Confirmed");
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Colour Craft//Production Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:CC Production — ${crew}`,
    `X-WR-CALDESC:Production schedule for ${crew}`,
    "X-WR-TIMEZONE:America/Vancouver",
    // Refresh interval hint (Apple Cal honours this; others may ignore)
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];

  for (const job of jobs) {
    if (!job.startDate) continue;
    const end = job.endDate || job.startDate;
    // Summary = client name only. Sub doesn't need to see the booked
    // value (their own rate is separate per the working agreement).
    const summary = job.name;
    // iCal DTEND for all-day events is EXCLUSIVE — add 1 day so the
    // event covers through end-of-end-date in calendar apps.
    const endPlusOne = new Date(end + "T12:00:00Z");
    endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
    const endIcal = fmtICalDate(endPlusOne.toISOString().slice(0, 10));
    // Description carries ONLY operational info the sub needs on-site:
    // estimated hours, scope, wash + colors status. Internal notes,
    // booked dollar value, and the dashboard URL are intentionally
    // excluded — that's planning/finance/admin info, not sub-facing.
    const descParts: string[] = [];
    if (job.estHours) descParts.push(`Hours: ${job.estHours}h`);
    if (job.washStatus) descParts.push(`Wash: ${job.washStatus}`);
    if (job.colorsStatus) descParts.push(`Colors: ${job.colorsStatus}`);
    if (job.phone) descParts.push(`Client: ${job.phone}`);
    // Removed 2026-05-10: scope (dropped UI, DripJobs work order is canonical)
    // and punch list (internal-only per Jared's audit; subs get instructions
    // via DripJobs work orders, not via iCal feed).
    const description = descParts.join("\\n");

    const event = [
      "BEGIN:VEVENT",
      `UID:${job.jobId}@cc-production.vercel.app`,
      `DTSTAMP:${fmtICalTimestamp(now)}`,
      `DTSTART;VALUE=DATE:${fmtICalDate(job.startDate)}`,
      `DTEND;VALUE=DATE:${endIcal}`,
      foldLine(`SUMMARY:${escapeICalText(summary)}`),
      foldLine(`DESCRIPTION:${description}`),
      job.address ? foldLine(`LOCATION:${escapeICalText(job.address)}`) : "",
      // Status is always CONFIRMED — we already filtered to confirmed
      // jobs above. STATUS line is required by some calendar apps.
      "STATUS:CONFIRMED",
      "END:VEVENT",
    ].filter(Boolean);
    lines.push(...event);
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
