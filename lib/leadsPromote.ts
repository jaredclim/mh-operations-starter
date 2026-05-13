/**
 * Leads → Pipeline auto-promote. The handoff is automatic, not
 * button-driven (per Jared 2026-05-11). When an Opportunity row is
 * created (via paste handoff, briefing automation, or any future UI),
 * this utility runs a match against the Leads tab and silently archives
 * the matching lead — clearing the row + logging the activity.
 *
 * Match keys (in priority order):
 *   1. Exact phone (after normalizing — strip non-digits)
 *   2. Exact email (lowercased)
 *   3. Address fuzzy match (strip Unit/Apt noise, normalize)
 *   4. Name + last-4-of-phone fallback
 *
 * On no match: nothing happens (some leads bypass the Leads tab —
 * e.g. D2D leads that get quoted same-day).
 *
 * On multi-match: archive the most recently-touched one, leave the
 * rest, log a soft warning.
 */

import { fetchLeads } from "./sheets";
import { clearRange, findLeadRowById, readCell, writeCell } from "./sheets";
import { logActivity } from "./activity";
import type { Lead } from "./types";

export interface PromoteMatchInput {
  phone?: string;
  email?: string;
  address?: string;
  name?: string;
  newOpportunityId?: string;        // For activity log
}

export interface PromoteMatchResult {
  matched: boolean;
  matchedLeadId?: string;
  matchedKey?: "phone" | "email" | "address" | "name+phone4";
  multipleMatches?: boolean;
}

function normalizePhone(p: string): string {
  return (p || "").replace(/\D/g, "");
}

function normalizeEmail(e: string): string {
  return (e || "").trim().toLowerCase();
}

function normalizeAddress(a: string): string {
  return (a || "")
    .toLowerCase()
    .replace(/\b(unit|apt|apartment|suite|ste)\s*#?\s*\w+\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(n: string): string {
  return (n || "").trim().toLowerCase();
}

export function findMatchingLead(leads: Lead[], input: PromoteMatchInput): { leads: Lead[]; key?: PromoteMatchResult["matchedKey"] } {
  const phone = normalizePhone(input.phone || "");
  const email = normalizeEmail(input.email || "");
  const address = normalizeAddress(input.address || "");
  const name = normalizeName(input.name || "");

  // 1. Phone exact
  if (phone) {
    const matches = leads.filter((l) => normalizePhone(l.phone) === phone);
    if (matches.length > 0) return { leads: matches, key: "phone" };
  }
  // 2. Email exact
  if (email) {
    const matches = leads.filter((l) => normalizeEmail(l.email) === email);
    if (matches.length > 0) return { leads: matches, key: "email" };
  }
  // 3. Address fuzzy
  if (address && address.length >= 8) {
    const matches = leads.filter((l) => {
      const la = normalizeAddress(l.address);
      return la && la.length >= 8 && (la === address || la.includes(address) || address.includes(la));
    });
    if (matches.length > 0) return { leads: matches, key: "address" };
  }
  // 4. Name + last 4 of phone
  if (name && phone.length >= 4) {
    const last4 = phone.slice(-4);
    const matches = leads.filter(
      (l) => normalizeName(l.name) === name && normalizePhone(l.phone).slice(-4) === last4
    );
    if (matches.length > 0) return { leads: matches, key: "name+phone4" };
  }
  return { leads: [] };
}

/**
 * Try to auto-archive a lead matching the new Opportunity. Returns
 * details about the match. Call this whenever a new Opportunity row is
 * appended to the Opportunities tab — paste handoff, briefing, future UI.
 *
 * Fire-and-forget safe — never throws. If anything goes wrong, returns
 * { matched: false } and the opportunity creation proceeds anyway.
 */
export async function tryAutoArchiveLeadForOpportunity(
  input: PromoteMatchInput
): Promise<PromoteMatchResult> {
  try {
    const leads = await fetchLeads();
    if (leads.length === 0) return { matched: false };
    const { leads: matches, key } = findMatchingLead(leads, input);
    if (matches.length === 0) return { matched: false };

    // Pick the most recently updated lead if multiple matched
    const target = matches.length === 1
      ? matches[0]
      : [...matches].sort((a, b) => (b.lastUpdated || "").localeCompare(a.lastUpdated || ""))[0];

    const row = await findLeadRowById(target.id);
    if (!row) return { matched: false };

    // Log on the lead's activity stream
    await logActivity(
      `L${target.id}`,
      "auto-archive",
      `→ Opportunity${input.newOpportunityId ? ` #${input.newOpportunityId}` : ""} (matched on ${key})`,
      "system"
    );
    if (input.newOpportunityId) {
      await logActivity(
        input.newOpportunityId,
        "promoted-from-lead",
        `Created from Lead #${target.id} (matched on ${key})`,
        "system"
      );
    }

    // Preserve a tiny breadcrumb: leave the lost reason field with a note
    // before clearing — useful only if the row is accidentally read after.
    await writeCell(`Leads!X${row}`, `Auto-promoted to Pipeline`);
    await clearRange(`Leads!A${row}:Y${row}`);

    return {
      matched: true,
      matchedLeadId: target.id,
      matchedKey: key,
      multipleMatches: matches.length > 1,
    };
  } catch (err) {
    // Fire-and-forget — never break opportunity creation
    console.error("tryAutoArchiveLeadForOpportunity failed:", err);
    return { matched: false };
  }
}
