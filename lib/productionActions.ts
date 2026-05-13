import {
  findRowByLeadId,
  writeCell,
  writeRow,
  appendProductionRow,
  bulkRenameCrew,
  clearRange,
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

async function findProdRow(jobId: string): Promise<number> {
  const row = await findRowByLeadId(jobId, "Production" as never);
  if (!row) throw new Error(`Production job ${jobId} not found`);
  return row;
}

/** Update schedule (crew + start + end + est hours). */
export async function updateSchedule(
  jobId: string,
  patch: { crew?: string; startDate?: string; endDate?: string; estHours?: number | null }
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  if (patch.crew !== undefined) await writeCell(`Production!G${row}`, patch.crew);
  if (patch.startDate !== undefined) await writeCell(`Production!H${row}`, patch.startDate);
  if (patch.endDate !== undefined) await writeCell(`Production!I${row}`, patch.endDate);
  if (patch.estHours !== undefined && patch.estHours !== null) {
    await writeCell(`Production!J${row}`, String(patch.estHours));
  }
  const parts: string[] = [];
  if (patch.crew !== undefined) parts.push(`crew=${patch.crew}`);
  if (patch.startDate !== undefined) parts.push(`start=${patch.startDate}`);
  if (patch.endDate !== undefined) parts.push(`end=${patch.endDate}`);
  if (patch.estHours !== undefined && patch.estHours !== null) parts.push(`hours=${patch.estHours}`);
  await logActivity(jobId, "schedule", parts.join(", ") || "no-op");
  return { ok: true };
}

/** Update status. */
export async function updateStatus(
  jobId: string,
  status: "Scheduled" | "Power Washed" | "Colors Picked" | "In Production" | "Complete"
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!K${row}`, status);
  await logActivity(jobId, "status", `→ ${status}`);
  return { ok: true };
}

/** Update movability flag. */
export async function updateMovability(
  jobId: string,
  movability: "Flexible" | "Window" | "Immovable",
  windowStart?: string,
  windowEnd?: string
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!L${row}`, movability);
  if (windowStart !== undefined) await writeCell(`Production!M${row}`, windowStart);
  if (windowEnd !== undefined) await writeCell(`Production!N${row}`, windowEnd);
  const win = windowStart || windowEnd ? ` (${windowStart || "?"} → ${windowEnd || "?"})` : "";
  await logActivity(jobId, "movability", `→ ${movability}${win}`);
  return { ok: true };
}

/** Update wash status (NA / Not Scheduled / Yes Scheduled / Complete). */
export async function updateWashStatus(
  jobId: string,
  status: "" | "NA" | "Not Scheduled" | "Yes Scheduled" | "Complete"
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!O${row}`, status);
  // Auto-set wash date when marked Complete
  if (status === "Complete") {
    await writeCell(`Production!P${row}`, todayISO());
  }
  await logActivity(jobId, "wash", `→ ${status || "(cleared)"}`);
  return { ok: true };
}

/** Update colors status (Match Required / Sample Required / Codes from Client / Confirmed Colours). */
export async function updateColorsStatus(
  jobId: string,
  status:
    | ""
    | "Match Required"
    | "Sample Required"
    | "Codes from Client"
    | "Confirmed Colours"
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!Q${row}`, status);
  // Auto-set colors date when confirmed
  if (status === "Confirmed Colours") {
    await writeCell(`Production!R${row}`, todayISO());
  }
  await logActivity(jobId, "colors", `→ ${status || "(cleared)"}`);
  return { ok: true };
}

/** Update materials ordered date. */
export async function updateMaterialsOrdered(
  jobId: string,
  date: string
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!S${row}`, date);
  await logActivity(jobId, "materials", `ordered ${date}`);
  return { ok: true };
}

/** Append a note (timestamped, prepended). */
export async function appendProductionNote(jobId: string, text: string): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  // Read existing notes
  const existing = await import("./sheets").then((m) => m.readCell(`Production!T${row}`));
  const today = todayISO();
  const newNote = `[${today}]: ${text.trim()}`;
  const combined = existing ? `${newNote}\n\n${existing}` : newNote;
  await writeCell(`Production!T${row}`, combined);
  const preview = text.trim().slice(0, 80) + (text.trim().length > 80 ? "…" : "");
  await logActivity(jobId, "note", preview);
  return { ok: true };
}

/** Mark client touch (cadence tracking). */
export async function logClientTouch(
  jobId: string,
  nextDays: number = 14
): Promise<{ ok: true; nextDate: string }> {
  const row = await findProdRow(jobId);
  const today = todayISO();
  const next = new Date(today + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + nextDays);
  const nextDate = next.toISOString().slice(0, 10);
  await writeRow(`Production!U${row}:V${row}`, [today, nextDate]);
  await logActivity(jobId, "touch", `logged; next ${nextDate}`);
  return { ok: true, nextDate };
}

/** Write explicit last + next touch dates — used for backdating ("I
 *  talked to them 2 days ago but didn't log it from my car"). Pass
 *  ISO YYYY-MM-DD strings; empty strings clear. */
export async function updateClientTouches(
  jobId: string,
  lastDate: string | null,
  nextDate: string | null
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeRow(`Production!U${row}:V${row}`, [lastDate || "", nextDate || ""]);
  const parts: string[] = [];
  if (lastDate) parts.push(`last=${lastDate}`);
  if (nextDate) parts.push(`next=${nextDate}`);
  if (!lastDate && !nextDate) parts.push("cleared");
  await logActivity(jobId, "touch", parts.join(", "));
  return { ok: true };
}

/** Update booked dollar value (column F). Used for change orders / scope removals. */
export async function updateBookedValue(
  jobId: string,
  value: number
): Promise<{ ok: true }> {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Booked value must be a non-negative number");
  }
  const row = await findProdRow(jobId);
  const formatted =
    value === 0
      ? ""
      : `$${value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await writeCell(`Production!F${row}`, formatted);
  await logActivity(jobId, "value", `→ ${formatted || "$0"}`);
  return { ok: true };
}

/** Update Scope / Crew Brief — project-defining info, NOT timestamped (replaces existing). */
export async function updateScope(jobId: string, scope: string): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!AC${row}`, scope);
  const preview = scope.trim().slice(0, 80) + (scope.trim().length > 80 ? "…" : "");
  await logActivity(jobId, "scope", scope.trim() ? `updated: ${preview}` : "cleared");
  return { ok: true };
}

/** Update Punch List — replaces the JSON array stored in column AE. */
export async function updatePunchList(
  jobId: string,
  items: { id: string; text: string; done: boolean }[]
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  const sanitized = items
    .filter((it) => it && typeof it.text === "string" && it.text.trim())
    .map((it) => ({
      id: it.id || `p${Math.random().toString(36).slice(2, 8)}`,
      text: it.text.trim(),
      done: Boolean(it.done),
    }));
  const serialized = sanitized.length ? JSON.stringify(sanitized) : "";
  await writeCell(`Production!AE${row}`, serialized);
  const doneCount = sanitized.filter((it) => it.done).length;
  await logActivity(jobId, "punch", `${doneCount}/${sanitized.length} done`);
  return { ok: true };
}

/** Update Auto-Confirm flag — when true, job appears in the confirmation
 *  banner once it hits Confirmed + start <72hr. When false, it's skipped.
 *  Default is true (opt-out, not opt-in). */
export async function updateAutoConfirm(jobId: string, value: boolean): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!AF${row}`, value ? "yes" : "no");
  await logActivity(jobId, "autoConfirm", value ? "enabled" : "disabled");
  return { ok: true };
}

/** Mark client confirmation as sent — writes today's date to AG so the
 *  job stops appearing in the confirmation banner. */
export async function markConfirmationSent(jobId: string): Promise<{ ok: true; date: string }> {
  const row = await findProdRow(jobId);
  const today = todayISO();
  await writeCell(`Production!AG${row}`, today);
  await logActivity(jobId, "confirm", `confirmation email sent ${today}`);
  return { ok: true, date: today };
}

/** Update Crew Status — Not Offered / Offered / Confirmed. */
export async function updateCrewStatus(
  jobId: string,
  crewStatus: "Not Offered" | "Offered" | "Confirmed"
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  await writeCell(`Production!AD${row}`, crewStatus);
  await logActivity(jobId, "crewStatus", `→ ${crewStatus}`);
  return { ok: true };
}

/** Update review tracking. */
export async function updateReview(
  jobId: string,
  patch: { requested?: boolean; received?: boolean; starsOrUrl?: string }
): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  const today = todayISO();
  if (patch.requested !== undefined) {
    await writeCell(`Production!Z${row}`, patch.requested ? today : "");
  }
  if (patch.received !== undefined) {
    await writeCell(`Production!AA${row}`, patch.received ? today : "");
  }
  if (patch.starsOrUrl !== undefined) {
    await writeCell(`Production!AB${row}`, patch.starsOrUrl);
  }
  const parts: string[] = [];
  if (patch.requested !== undefined) parts.push(patch.requested ? "requested" : "un-requested");
  if (patch.received !== undefined) parts.push(patch.received ? "received" : "un-received");
  if (patch.starsOrUrl !== undefined) parts.push(`stars/url=${patch.starsOrUrl}`);
  await logActivity(jobId, "review", parts.join(", ") || "no-op");
  return { ok: true };
}

/** Rename a crew across all Production rows. Bulk-updates every job whose
 *  crew column matches the old name to the new name. Returns the number
 *  of rows changed so the caller can confirm to the user. */
export async function renameCrew(
  oldName: string,
  newName: string
): Promise<{ ok: true; updated: number }> {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew) throw new Error("Crew names cannot be empty");
  if (trimmedOld === trimmedNew) return { ok: true, updated: 0 };
  const { updated } = await bulkRenameCrew(trimmedOld, trimmedNew);
  await logActivity("", "renameCrew", `${trimmedOld} → ${trimmedNew} (${updated} rows)`);
  return { ok: true, updated };
}

/** Manually create a Production row (e.g., for jobs that pre-date V4 dashboard). */
export async function createProductionJob(input: {
  jobId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  bookedValue?: number;
  crew?: string;
  startDate?: string;
  endDate?: string;
  estHours?: number;
  movability?: "Flexible" | "Window" | "Immovable";
}): Promise<{ ok: true }> {
  const today = todayISO();
  const bookedValueFormatted = input.bookedValue
    ? `$${input.bookedValue.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";
  const row: string[] = [
    input.jobId,
    input.name,
    input.phone || "",
    input.email || "",
    input.address || "",
    bookedValueFormatted,
    input.crew || "",
    input.startDate || "",
    input.endDate || "",
    input.estHours ? String(input.estHours) : "",
    "Scheduled",
    input.movability || "Flexible",
    "", "", "NO", "", "NO", "", "",
    `Manually created on ${today}.`,
    // U Last Client Touch — defaults to today since CC always touches
    // the client at booking. Jared can update later via the drawer.
    today,
    "", "", "", "", "", "", "",
    // AC Scope / AD Crew Status / AE Punch List / AF Auto-Confirm / AG Confirmation Sent
    "", "", "", "yes", "",
  ];
  await appendProductionRow(row);
  await logActivity(input.jobId, "create", `${input.name}${input.crew ? ` to ${input.crew}` : ""}${input.startDate ? ` (${input.startDate}${input.endDate ? "→" + input.endDate : ""})` : ""}`);
  return { ok: true };
}

/**
 * Permanently delete a production job — clears the entire row (A:AG)
 * in the Production sheet. Logs to activity for audit. Per Jared
 * 2026-05-12: needed for jobs added by accident or for cleanup.
 *
 * The row is CLEARED, not removed — leaves a blank row in the sheet
 * which the parser filters out (empty Name skips the row). This avoids
 * row-mapping issues with other features that reference sheet rows.
 */
export async function deleteProductionJob(jobId: string): Promise<{ ok: true }> {
  const row = await findProdRow(jobId);
  // Log BEFORE clear so the activity log retains the audit trail
  await logActivity(jobId, "delete", `Job deleted from Production tab`);
  await clearRange(`Production!A${row}:AG${row}`);
  return { ok: true };
}
