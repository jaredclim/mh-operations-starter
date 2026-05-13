/**
 * Server-side lead mutation actions for the Leads (pre-estimate) tab.
 * Mirrors lib/leadActions.ts (for Opportunities) but operates on the
 * Leads tab schema (25 cols A-Y). All writes log to the Activity tab
 * via logActivity for the audit log surface.
 *
 * Column reference (Leads!A-Y):
 *   A ID, B Name, C Phone, D Email, E Address, F Lead Source, G Stage,
 *   H First Inquiry Date, I Stage Date, J Callback Time,
 *   K Estimate Visit Date, L Original Estimate Date, M Reschedule Count,
 *   N Setup Call Done, O Setup Call Date, P Long-Term Reach-Out Date,
 *   Q Last Touch Date, R Last Touch Type, S Next Touch Date,
 *   T Next Touch Type, U Contact Attempts, V Notes, W DripJobs Link,
 *   X Lost Reason, Y Last Updated
 */

import {
  appendLeadRow,
  clearRange,
  findLeadRowById,
  readCell,
  writeCell,
  writeRow,
} from "./sheets";
import { logActivity } from "./activity";
import type { LeadStage, LeadLostReason, LeadSource } from "./types";

const TZ = "America/Vancouver";

function todayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function leadActivityId(leadId: string): string {
  return `L${leadId}`;
}

/** Log a touch. Updates Q (Last Touch Date), R (Last Touch Type), Y (Last Updated).
 *  For Call/VM, increments U (Contact Attempts). */
export async function logLeadTouch(
  leadId: string,
  type: "Call" | "VM" | "Email" | "Text" | "Note"
): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  await writeRow(`Leads!Q${row}:R${row}`, [today, type]);
  await writeCell(`Leads!Y${row}`, today);
  if (type === "Call" || type === "VM") {
    const current = await readCell(`Leads!U${row}`);
    const n = parseInt(current || "0", 10);
    const next = isNaN(n) ? 1 : n + 1;
    await writeCell(`Leads!U${row}`, String(next));
  }
  await logActivity(leadActivityId(leadId), "touch", type, "Jared");
  return { ok: true };
}

/** Set next touch date / type. S = Next Touch Date, T = Next Touch Type. */
export async function snoozeLead(
  leadId: string,
  date: string,
  fuType?: "Call" | "Email" | "Text"
): Promise<{ ok: true; nextDate: string }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  if (fuType) {
    await writeRow(`Leads!S${row}:T${row}`, [date, fuType]);
  } else {
    await writeCell(`Leads!S${row}`, date);
  }
  await writeCell(`Leads!Y${row}`, today);
  await logActivity(leadActivityId(leadId), "snooze", `next ${date}${fuType ? ` · ${fuType}` : ""}`, "Jared");
  return { ok: true, nextDate: date };
}

/** Append a timestamped note. Column V. */
export async function appendLeadNote(leadId: string, text: string): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  const existing = await readCell(`Leads!V${row}`);
  const newNote = `[${today}]: ${text.trim()}`;
  const combined = existing ? `${newNote}\n\n${existing}` : newNote;
  await writeCell(`Leads!V${row}`, combined);
  await writeCell(`Leads!Y${row}`, today);
  const preview = text.trim().slice(0, 80) + (text.trim().length > 80 ? "…" : "");
  await logActivity(leadActivityId(leadId), "note", preview, "Jared");
  return { ok: true };
}

/** Change stage. Resets Stage Date (I). For Lost, use archiveLead instead. */
export async function changeLeadStage(
  leadId: string,
  newStage: Exclude<LeadStage, "Lost">,
  extra: {
    callbackTime?: string;             // For Callback requested
    estimateVisitDate?: string;        // For Estimate booked (initial)
    longTermReachOutDate?: string;     // For Long-term hold
  } = {}
): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  await writeCell(`Leads!G${row}`, newStage);
  await writeCell(`Leads!I${row}`, today);
  if (newStage === "Callback requested" && extra.callbackTime) {
    await writeCell(`Leads!J${row}`, extra.callbackTime);
  }
  if (newStage === "Estimate booked" && extra.estimateVisitDate) {
    await writeCell(`Leads!K${row}`, extra.estimateVisitDate);
    // Also write Original Estimate Date if not set
    const original = await readCell(`Leads!L${row}`);
    if (!original) {
      await writeCell(`Leads!L${row}`, extra.estimateVisitDate);
    }
  }
  if (newStage === "Long-term hold" && extra.longTermReachOutDate) {
    await writeCell(`Leads!P${row}`, extra.longTermReachOutDate);
  }
  await writeCell(`Leads!Y${row}`, today);
  await logActivity(leadActivityId(leadId), "stage", `→ ${newStage}`, "Jared");
  return { ok: true };
}

/** Mark setup call done (N=YES, O=today). */
export async function markSetupCallDone(leadId: string, done: boolean): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  await writeRow(`Leads!N${row}:O${row}`, [done ? "YES" : "NO", done ? today : ""]);
  await writeCell(`Leads!Y${row}`, today);
  await logActivity(leadActivityId(leadId), "setup-call", done ? "done" : "cleared", "Jared");
  return { ok: true };
}

/** Reschedule the estimate visit. Increments M (Reschedule Count). */
export async function rescheduleEstimate(leadId: string, newDate: string): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  await writeCell(`Leads!K${row}`, newDate);
  // Increment reschedule count
  const current = await readCell(`Leads!M${row}`);
  const n = parseInt(current || "0", 10);
  const next = isNaN(n) ? 1 : n + 1;
  await writeCell(`Leads!M${row}`, String(next));
  // Ensure original estimate date is preserved (set if blank)
  const original = await readCell(`Leads!L${row}`);
  if (!original) {
    await writeCell(`Leads!L${row}`, newDate); // best-effort fallback; ideally written at booking
  }
  await writeCell(`Leads!Y${row}`, today);
  await logActivity(leadActivityId(leadId), "reschedule", `→ ${newDate} (count ${next})`, "Jared");
  return { ok: true };
}

/** Archive lead as Lost. Clears the row from Leads. */
export async function archiveLeadAsLost(
  leadId: string,
  reason: LeadLostReason | string,
  note?: string
): Promise<{ ok: true }> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  const today = todayISO();
  // Update lost reason + stage before clearing — keeps a small audit trace
  // in case Jared wants to recover by reading the activity log.
  if (note) {
    const existing = await readCell(`Leads!V${row}`);
    const newNote = `[${today}] ❌ LOST · ${reason}${note ? ` · ${note}` : ""}`;
    await writeCell(`Leads!V${row}`, existing ? `${newNote}\n\n${existing}` : newNote);
  }
  await writeCell(`Leads!G${row}`, "Lost");
  await writeCell(`Leads!X${row}`, reason);
  await writeCell(`Leads!Y${row}`, today);
  await logActivity(leadActivityId(leadId), "lost", `${reason}${note ? ` · ${note}` : ""}`, "Jared");
  // Clear the row to remove from active view (Lost stage is filtered out anyway,
  // but clearing keeps the sheet tidy)
  await clearRange(`Leads!A${row}:Y${row}`);
  return { ok: true };
}

/**
 * Bulk create leads from parsed CSV rows. Returns counts of created /
 * skipped (duplicate by phone or email or name+address) / failed.
 *
 * Skip logic — checks the EXISTING Leads tab AND Opportunities tab
 * for duplicates so we don't import a lead that's already in the
 * Pipeline. Match: phone (digits-only) or email (lowercase) or
 * normalized name+address.
 */
export async function bulkCreateLeads(
  rows: Array<{
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    leadSource?: string;
    stage?: LeadStage;
    firstInquiryDate?: string;
    notes?: string;
    dripJobsLink?: string;
  }>
): Promise<{ created: number; skipped: number; errors: string[]; createdIds: string[] }> {
  const { fetchLeads, fetchOpportunities } = await import("./sheets");
  const [existingLeads, existingOpps] = await Promise.all([
    fetchLeads().catch(() => []),
    fetchOpportunities().catch(() => []),
  ]);

  function norm(s: string): string {
    return (s || "").trim().toLowerCase();
  }
  function normPhone(p: string): string {
    return (p || "").replace(/\D/g, "");
  }
  function normAddr(a: string): string {
    return (a || "")
      .toLowerCase()
      .replace(/\b(unit|apt|apartment|suite|ste)\s*#?\s*\w+\b/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Index existing entries by phone, email, name+address
  const existingPhones = new Set<string>();
  const existingEmails = new Set<string>();
  const existingNameAddr = new Set<string>();
  for (const l of existingLeads) {
    if (l.phone) existingPhones.add(normPhone(l.phone));
    if (l.email) existingEmails.add(norm(l.email));
    if (l.name && l.address) existingNameAddr.add(`${norm(l.name)}|${normAddr(l.address)}`);
  }
  for (const o of existingOpps) {
    if (o.phone) existingPhones.add(normPhone(o.phone));
    if (o.email) existingEmails.add(norm(o.email));
    if (o.name && o.address) existingNameAddr.add(`${norm(o.name)}|${normAddr(o.address)}`);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const createdIds: string[] = [];

  // Also dedupe within the batch itself
  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();
  const batchNameAddr = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.name?.trim()) {
      errors.push(`Row ${i + 1}: missing name`);
      continue;
    }
    const p = normPhone(r.phone || "");
    const e = norm(r.email || "");
    const na = r.address ? `${norm(r.name)}|${normAddr(r.address)}` : "";

    const dupExisting =
      (p && existingPhones.has(p)) ||
      (e && existingEmails.has(e)) ||
      (na && existingNameAddr.has(na));
    const dupBatch =
      (p && batchPhones.has(p)) ||
      (e && batchEmails.has(e)) ||
      (na && batchNameAddr.has(na));

    if (dupExisting || dupBatch) {
      skipped++;
      continue;
    }

    try {
      const res = await createLead({
        name: r.name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        leadSource: r.leadSource || "Other",
        stage: r.stage || "New",
        firstInquiryDate: r.firstInquiryDate,
        notes: r.notes,
        dripJobsLink: r.dripJobsLink,
      });
      created++;
      createdIds.push(res.id);
      if (p) batchPhones.add(p);
      if (e) batchEmails.add(e);
      if (na) batchNameAddr.add(na);
    } catch (err) {
      errors.push(`Row ${i + 1} (${r.name}): ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { created, skipped, errors, createdIds };
}

/** Create a brand-new lead from minimal input. Used by the +Add Lead modal. */
export async function createLead(input: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  leadSource: LeadSource | string;
  stage?: LeadStage;
  firstInquiryDate?: string;
  notes?: string;
  dripJobsLink?: string;
}): Promise<{ ok: true; id: string }> {
  const today = todayISO();
  const stage = input.stage || "New";
  const firstInquiry = input.firstInquiryDate || today;
  const values = [
    "",                              // A ID — auto-assigned by appendLeadRow
    input.name.trim(),               // B
    (input.phone || "").trim(),      // C
    (input.email || "").trim(),      // D
    (input.address || "").trim(),    // E
    input.leadSource,                // F
    stage,                           // G
    firstInquiry,                    // H
    today,                           // I Stage Date
    "",                              // J Callback Time
    "",                              // K Estimate Visit Date
    "",                              // L Original Estimate Date
    "0",                             // M Reschedule Count
    "NO",                            // N Setup Call Done
    "",                              // O Setup Call Date
    "",                              // P Long-Term Reach-Out Date
    "",                              // Q Last Touch Date
    "",                              // R Last Touch Type
    "",                              // S Next Touch Date
    "",                              // T Next Touch Type
    "0",                             // U Contact Attempts
    input.notes ? `[${today}] ${input.notes}` : "", // V
    (input.dripJobsLink || "").trim(),               // W
    "",                              // X Lost Reason
    today,                           // Y Last Updated
  ];
  const { id } = await appendLeadRow(values);
  await logActivity(leadActivityId(id), "create", `${input.name} · ${input.leadSource}`, "Jared");
  return { ok: true, id };
}
