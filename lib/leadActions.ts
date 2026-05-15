/**
 * Server-side lead mutation actions. Each function:
 *   1. Looks up the lead's actual sheet row (NEVER assume row = ID — see
 *      ~/.claude/.../feedback_sheet_row_id_mapping.md)
 *   2. Performs the write
 *   3. Returns minimal success info; caller handles cache invalidation
 */

import {
  appendProductionRow,
  clearRange,
  findFirstEmptyArchiveRow,
  findRowByLeadId,
  nextProductionJobId,
  readCell,
  readRow,
  writeCell,
  writeRow,
} from "./sheets";
import { logActivity } from "./activity";

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

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Log a touch — updates Last Touch Date + Last Touch Type, increments Call Attempts on call types. */
export async function logTouch(
  leadId: string,
  type: "Call" | "VM" | "Email" | "Text" | "Estimate" | "Note"
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const today = todayISO();
  // K = Last Touch Date, L = Last Touch Type, W = Last Updated
  await writeRow(`Opportunities!K${row}:L${row}`, [today, type]);
  await writeCell(`Opportunities!W${row}`, today);

  // Increment call attempts (column AB) on Call/VM
  if (type === "Call" || type === "VM") {
    const current = await readCell(`Opportunities!AB${row}`);
    const n = parseInt(current || "0", 10);
    const next = isNaN(n) ? 1 : n + 1;
    await writeCell(`Opportunities!AB${row}`, String(next));
  }

  // For Email touches, also update Last Email Sent (X)
  if (type === "Email") {
    await writeCell(`Opportunities!X${row}`, today);
  }

  // AUTO-CLEAR PROMISE if it was due today-or-earlier — the touch satisfies it.
  // Without this, the promise-overdue check in focusQueue keeps firing day
  // after day for the same already-attempted lead (Gus Labao bug 2026-05-12).
  // Logic: if promise=YES with promisedTime being a past or today date, clear.
  // Future-dated promises stay intact (touch doesn't cancel a future commitment).
  try {
    const promiseRange = await sheets_readCellPair(`Opportunities!O${row}:P${row}`);
    const isPromise = (promiseRange[0] || "").toUpperCase() === "YES";
    const promisedTime = promiseRange[1] || "";
    const promiseIsoMatch = /^\d{4}-\d{2}-\d{2}/.exec(promisedTime);
    if (isPromise && promiseIsoMatch) {
      const promiseDate = promiseIsoMatch[0].slice(0, 10);
      if (promiseDate <= today) {
        await writeRow(`Opportunities!O${row}:P${row}`, ["NO", ""]);
        await logActivity(leadId, "promise", `auto-cleared on touch (was ${promiseDate})`);
      }
    } else if (isPromise && promisedTime && !promiseIsoMatch) {
      // Free-text promise (e.g. "Monday 3pm") — clear on any touch, the
      // commitment was time-of-day-ish and a touch is the action.
      await writeRow(`Opportunities!O${row}:P${row}`, ["NO", ""]);
      await logActivity(leadId, "promise", `auto-cleared on touch (was "${promisedTime}")`);
    }
  } catch {
    // Promise auto-clear is best-effort; don't fail the touch over it
  }

  await logActivity(leadId, "touch", `${type}`);
  return { ok: true };
}

// Helper to read a pair of cells in a row range. Used by the auto-clear-promise
// logic in logTouch.
async function sheets_readCellPair(range: string): Promise<[string, string]> {
  const result = await readRow(range);
  return [result[0] || "", result[1] || ""];
}

/**
 * Push the next follow-up by N days from today, or set explicit date.
 *
 * `manual` flag (default false):
 *   - `true`  — Jared explicitly set this date (from Focus Mode picker,
 *               drawer date input, briefing override, MCP call). Sets the
 *               Manual FU Lock (col AF) = TRUE so future auto-snooze on
 *               touch doesn't overwrite it. Lock stays sticky until the
 *               locked date arrives.
 *   - `false` — auto-snooze path (called after a touch from phase cadence).
 *               If a manual lock is currently active AND the locked date
 *               is still in the future, this is a NO-OP — the lock wins.
 *               If the lock has expired (locked date <= today), the lock
 *               is cleared and the new auto-snooze date is written.
 */
export async function snoozeFollowUp(
  leadId: string,
  daysOrDate: number | string,
  fuType?: "Call" | "Email" | "Text",
  manual: boolean = false
): Promise<{ ok: true; nextDate: string; skipped?: boolean }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const today = todayISO();
  const nextDate = typeof daysOrDate === "number" ? addDays(today, daysOrDate) : daysOrDate;

  // Manual lock gating — auto-snooze NEVER overrides a manual lock with a
  // future locked date. Only manual=true can change the FU when locked.
  if (!manual) {
    try {
      const lockState = await sheets_readCellPair(`Opportunities!M${row}:M${row}`);
      const currentFu = lockState[0] || "";
      const lockRaw = await readCell(`Opportunities!AF${row}`);
      const isLocked = (lockRaw || "").trim().toUpperCase() === "TRUE";
      if (isLocked) {
        if (currentFu && currentFu > today) {
          // Lock active, locked date still future → skip auto-snooze entirely
          await logActivity(leadId, "snooze", `skipped (manual lock holds FU=${currentFu})`);
          return { ok: true, nextDate: currentFu, skipped: true };
        }
        // Lock expired (locked date passed) — clear lock + proceed with auto-snooze
        await writeCell(`Opportunities!AF${row}`, "");
        await logActivity(leadId, "snooze", `manual lock expired, resuming auto cadence`);
      }
    } catch {
      // best-effort; if we can't read the lock, fall through to normal write
    }
  }

  // M = Next FU Date, N = Next FU Type (only update if provided)
  if (fuType) {
    await writeRow(`Opportunities!M${row}:N${row}`, [nextDate, fuType]);
  } else {
    await writeCell(`Opportunities!M${row}`, nextDate);
  }
  await writeCell(`Opportunities!W${row}`, today);

  // Set or clear the lock flag in col AF
  if (manual) {
    await writeCell(`Opportunities!AF${row}`, "TRUE");
  }

  await logActivity(leadId, "snooze", `${manual ? "manual" : "auto"} → ${nextDate}${fuType ? ` · ${fuType}` : ""}`);
  return { ok: true, nextDate };
}

/** Explicitly clear the manual FU lock (returns lead to auto-cadence). */
export async function clearManualFuLock(leadId: string): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);
  await writeCell(`Opportunities!AF${row}`, "");
  await logActivity(leadId, "snooze", `manual lock cleared`);
  return { ok: true };
}

/**
 * Update the to-do list for an opportunity — stores in column AE as a
 * JSON array. Mirrors the punchList pattern used by Production
 * (lib/productionActions.ts::updatePunchList). Both Jared and his
 * production manager add/check items here; the card surfaces a badge
 * when any item is incomplete so he sees at-a-glance which leads have
 * outstanding to-dos without opening the drawer.
 */
export async function updateOppTodoList(
  leadId: string,
  items: { id: string; text: string; done: boolean }[]
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const sanitized = items
    .filter((it) => it && typeof it.text === "string" && it.text.trim())
    .map((it) => ({
      id: it.id || `t${Math.random().toString(36).slice(2, 8)}`,
      text: it.text.trim(),
      done: Boolean(it.done),
    }));
  const serialized = sanitized.length ? JSON.stringify(sanitized) : "";
  await writeCell(`Opportunities!AE${row}`, serialized);
  await writeCell(`Opportunities!W${row}`, todayISO());

  const doneCount = sanitized.filter((it) => it.done).length;
  await logActivity(leadId, "todo", `${doneCount}/${sanitized.length} done`);
  return { ok: true };
}

/** Append a note (with timestamp prefix) to the Notes column. */
export async function appendNote(leadId: string, text: string): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const today = todayISO();
  const existing = await readCell(`Opportunities!S${row}`);
  const newNote = `[${today}]: ${text.trim()}`;
  const combined = existing ? `${newNote}\n\n${existing}` : newNote;
  await writeCell(`Opportunities!S${row}`, combined);
  await writeCell(`Opportunities!W${row}`, today);

  const preview = text.trim().slice(0, 80) + (text.trim().length > 80 ? "…" : "");
  await logActivity(leadId, "note", preview);
  return { ok: true };
}

/** Change stage (Verbal Yes / On Hold / Long-Term). For Won/Lost, use archiveLead instead. */
/** Returns YYYY-02-15 of the next upcoming February 15.
 *  If today is before Feb 15 of this year → this year's Feb 15.
 *  Otherwise → next year's Feb 15. Used as the Long-Term re-engagement date.
 */
function nextFebruary15(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value);
  const day = parseInt(parts.find((p) => p.type === "day")!.value);
  // If Feb 15 this year hasn't arrived yet, use it; otherwise next year.
  if (month < 2 || (month === 2 && day < 15)) {
    return `${year}-02-15`;
  }
  return `${year + 1}-02-15`;
}

export async function changeStage(
  leadId: string,
  newStage: "Proposal Sent" | "Verbal Yes" | "On Hold" | "Long-Term"
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  await writeCell(`Opportunities!G${row}`, newStage);
  await writeCell(`Opportunities!W${row}`, todayISO());

  // Auto-set re-engagement FU when moving to Long-Term. Feb 15 next year =
  // start of painting season — right moment to check back in. Sets manual
  // lock so auto-snooze on future touches doesn't overwrite it.
  if (newStage === "Long-Term") {
    const feb15 = nextFebruary15();
    await writeCell(`Opportunities!M${row}`, feb15);
    await writeCell(`Opportunities!N${row}`, "Call");
    await writeCell(`Opportunities!AF${row}`, "TRUE");
    await logActivity(leadId, "snooze", `auto → ${feb15} Call (Long-Term re-engagement)`);
  }

  await logActivity(leadId, "stage", `→ ${newStage}`);
  return { ok: true };
}

/** Set or clear Promise + Promised Time. */
export async function setPromise(
  leadId: string,
  promise: boolean,
  time?: string
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  await writeRow(`Opportunities!O${row}:P${row}`, [
    promise ? "YES" : "NO",
    promise && time ? time : "",
  ]);
  await writeCell(`Opportunities!W${row}`, todayISO());

  await logActivity(leadId, "promise", promise ? `set${time ? ` · by ${time}` : ""}` : "cleared");
  return { ok: true };
}

/** Update the Est Value (e.g. proposal revised). */
export async function updateEstValue(
  leadId: string,
  value: number
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const formatted = `$${value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await writeCell(`Opportunities!H${row}`, formatted);
  await writeCell(`Opportunities!W${row}`, todayISO());

  await logActivity(leadId, "value", `${formatted}`);
  return { ok: true };
}

/**
 * Resolve a Won or Lost lead from the Opportunities tab.
 *
 * Routing (per Jared 2026-05-15):
 *   - Lost → Archive tab. Archive is for rejected proposals only.
 *   - Won  → "In Production" tab. Active clients live there until the job
 *            is marked Complete (at which point they move to "Completed Jobs").
 *            Won deals do NOT get an Archive row.
 *
 * Returns the row number written. For Won, that's the In Production row;
 * for Lost, that's the Archive row. Kept as `archiveRow` for backwards-compat
 * with existing callers.
 */
export async function archiveLead(
  leadId: string,
  result: "Won" | "Lost",
  extra: { bookedValue?: number; reasonLost?: string; note?: string } = {}
): Promise<{ ok: true; archiveRow: number }> {
  const oppRow = await findRowByLeadId(leadId);
  if (!oppRow) throw new Error(`Lead ID ${leadId} not found in Opportunities`);

  const today = todayISO();
  const opp = await readRow(`Opportunities!A${oppRow}:AD${oppRow}`);

  // Map Opportunity columns to Archive schema (24 cols A-X)
  // Archive: A id, B name, C phone, D email, E address, F lead source,
  //   G final stage, H est value, I est date, J proposal date, K last touch,
  //   L last touch type, M result, N result date, O days from estimate to close,
  //   P booked?, Q booked value, R reason lost, S nurture step, T total touches,
  //   U notes, V dripjobs link, W archive date, X last updated
  const id = opp[0] || leadId;
  const name = opp[1] || "";
  const phone = opp[2] || "";
  const email = opp[3] || "";
  const address = opp[4] || "";
  const leadSource = opp[5] || "";
  const estValue = opp[7] || "";
  const estDate = opp[8] || "";
  const proposalDate = opp[9] || "";
  const lastTouchDate = opp[10] || "";
  const lastTouchType = opp[11] || "";
  const nurtureStep = opp[16] || "";
  const existingNotes = opp[18] || "";
  const dripJobsLink = opp[19] || "";
  const callAttempts = opp[27] || "";

  const daysToClose = estDate
    ? String(Math.max(0, Math.floor((new Date(today).getTime() - new Date(estDate).getTime()) / 86400000)))
    : "";

  const bookedValueFormatted =
    extra.bookedValue !== undefined
      ? `$${extra.bookedValue.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "";

  const archiveNote = `[${today}] ${result === "Won" ? "🎉 WON" : "❌ LOST"} via dashboard quick action.${
    extra.note ? " " + extra.note : ""
  }${extra.reasonLost ? ` Reason: ${extra.reasonLost}.` : ""}${
    bookedValueFormatted ? ` Booked at ${bookedValueFormatted}.` : ""
  }\n\n${existingNotes}`;

  let resultRow: number;

  if (result === "Won") {
    // WON → write to "In Production" tab only. No Archive row.
    const jobId = await nextProductionJobId(); // P-format (P31, P32, …)

    // Derive numeric pre-tax value for Est Hours estimate.
    // If extra.bookedValue was passed it's already pre-tax (Jared enters that
    // way per the pre-tax rule). If we fall back to the Opportunities Est
    // Value (col H), that's also pre-tax. So no /1.05 division needed here.
    const numericValue =
      extra.bookedValue !== undefined
        ? extra.bookedValue
        : parseFloat(String(estValue).replace(/[$,\s]/g, "")) || 0;

    // Est Hours = pre-tax dollars / $100/hr (CC's rough rate, per Jared
    // 2026-05-15). Whole number — these are rough estimates for scheduling,
    // not billing. Crew lead can override on the day.
    const estHoursAuto = numericValue > 0 ? String(Math.round(numericValue / 100)) : "";

    const productionRow: string[] = [
      jobId,                                   // A Job ID (P-format)
      String(name),                            // B Client Name
      String(phone),                           // C Phone
      String(email),                           // D Email
      String(address),                         // E Address
      bookedValueFormatted || String(estValue),// F Booked Value (pre-tax)
      "",                                      // G Crew (assign later)
      "",                                      // H Start Date (schedule later)
      "",                                      // I End Date
      estHoursAuto,                            // J Est Hours (auto = value/100)
      "Scheduled",                             // K Status
      "Flexible",                              // L Movability (default)
      "",                                      // M Window Start
      "",                                      // N Window End
      "",                                      // O Wash Status
      "",                                      // P Wash Date
      "",                                      // Q Colors Status
      "",                                      // R Colors Date
      "",                                      // S Materials Ordered Date
      `Booked ${today} from Opportunities ID ${id}. ${extra.note || ""}`.trim() +
        (existingNotes ? `\n\n--- Sales notes ---\n${existingNotes}` : ""), // T Production Notes
      today,                                   // U Last Client Touch (booking day)
      "",                                      // V Next Client Touch
      "",                                      // W Lawn Sign Up Date
      "",                                      // X Lawn Sign Down Date
      "",                                      // Y Invoice Sent Date
      "",                                      // Z Review Requested Date
      "",                                      // AA
      "",                                      // AB
      "",                                      // AC Scope
      "",                                      // AD Crew Status
      "",                                      // AE Punch List
      "yes",                                   // AF Auto-Confirm
      "",                                      // AG Confirmation Sent
    ];
    const { row } = await appendProductionRow(productionRow);
    resultRow = row;
  } else {
    // LOST → write to Archive tab only.
    // Archive schema: 24 cols A-X
    // A id, B name, C phone, D email, E address, F lead source, G final stage,
    // H est value, I est date, J proposal date, K last touch, L last touch type,
    // M result, N result date, O days from estimate to close, P booked?,
    // Q booked value, R reason lost, S nurture step, T total touches,
    // U notes, V dripjobs link, W archive date, X last updated
    const archiveRow: string[] = [
      id, name, phone, email, address, leadSource, result, estValue, estDate,
      proposalDate, lastTouchDate, lastTouchType, result, today, daysToClose,
      "NO", "", extra.reasonLost || "", nurtureStep, callAttempts, archiveNote,
      dripJobsLink, today, today,
    ];
    const archRow = await findFirstEmptyArchiveRow();
    await writeRow(`Archive!A${archRow}:X${archRow}`, archiveRow);
    resultRow = archRow;
  }

  await clearRange(`Opportunities!A${oppRow}:AD${oppRow}`);

  const detail = `${result}${result === "Won" && extra.bookedValue ? ` · $${extra.bookedValue.toFixed(2)}` : ""}${result === "Lost" && extra.reasonLost ? ` · ${extra.reasonLost}` : ""}`;
  await logActivity(leadId, "archive", detail);
  return { ok: true, archiveRow: resultRow };
}

/**
 * Revert a touch — restores pre-action state to the lead row.
 * Used by Focus Mode "Undo" button when Jared accidentally clicks a
 * Call/VM/Text/Email/Note (or picks the wrong disposition). The client
 * captures the lead's prior state before the action fires; this restores
 * those exact values.
 *
 * Restores: K (Last Touch Date), L (Last Touch Type), M (Next FU Date),
 *   AB (Call Attempts), S (Notes — only if a prior snapshot was provided
 *   for the disposition-note case).
 *
 * Logs the revert as its own activity entry so the audit trail is honest
 * (you can see Jared clicked, then immediately undid).
 */
export async function revertTouch(
  leadId: string,
  snapshot: {
    lastTouchDate?: string;
    lastTouchType?: string;
    nextFollowUpDate?: string;
    callAttempts?: number;
    notes?: string; // The notes column value BEFORE the disposition note was prepended
  }
): Promise<{ ok: true }> {
  const row = await findRowByLeadId(leadId);
  if (!row) throw new Error(`Lead ID ${leadId} not found`);

  const today = todayISO();

  // Restore last touch date + type (empty string clears the cell if pre-state had none)
  await writeRow(`Opportunities!K${row}:L${row}`, [
    snapshot.lastTouchDate ?? "",
    snapshot.lastTouchType ?? "",
  ]);

  // Restore next-FU date if a prior value existed
  if (snapshot.nextFollowUpDate !== undefined) {
    await writeCell(`Opportunities!M${row}`, snapshot.nextFollowUpDate);
  }

  // Restore call attempts counter
  if (snapshot.callAttempts !== undefined) {
    await writeCell(`Opportunities!AB${row}`, String(snapshot.callAttempts));
  }

  // Restore notes column if a snapshot was provided (disposition note removal)
  if (snapshot.notes !== undefined) {
    await writeCell(`Opportunities!S${row}`, snapshot.notes);
  }

  await writeCell(`Opportunities!W${row}`, today);
  await logActivity(leadId, "revert", "undid last touch/disposition");
  return { ok: true };
}
