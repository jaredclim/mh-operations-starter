import { google } from "googleapis";
import type {
  ArchiveRecord,
  ColorsStatus,
  CrewStatus,
  EstimatePoint,
  Lead,
  LeadStage,
  Movability,
  Opportunity,
  ProductionJob,
  ProductionStatus,
  Stage,
  WashStatus,
} from "./types";
import { LEAD_STAGES } from "./types";
import { parseCurrency, parseDate, parseDecimal, parseInteger } from "./utils";

export const SHEET_ID = process.env.GOOGLE_SHEET_ID || "YOUR_SHEET_ID_HERE";
const RANGE = "Opportunities!A2:AE1000";
const ARCHIVE_RANGE = "Archive!A2:X1000";
const PRODUCTION_RANGE = "Production!A2:AG1000";
const LEADS_RANGE = "Leads!A2:Y1000";

const VALID_STAGES: Stage[] = [
  "Proposal Sent",
  "Verbal Yes",
  "On Hold",
  "Long-Term",
  "Won",
  "Lost",
  "Archived",
];

export function getServiceAccountAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var not set");
  }
  const parsed = JSON.parse(raw);
  return new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    // Read-write scope — V2 dashboard editing requires writes back to the sheet.
    // Service account also needs writer permission on the sheet (granted via
    // manage_drive_access).
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Find the actual sheet row number (1-indexed) for a given lead ID.
 * Returns null if not found. Critical for write operations to avoid the
 * row-mapping bug (sheet rows do NOT equal IDs because of header + archive gaps).
 */
export async function findRowByLeadId(
  leadId: string,
  sheetName: "Opportunities" | "Archive" = "Opportunities"
): Promise<number | null> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:A1000`,
  });
  const rows = data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const cellValue = String(rows[i]?.[0] ?? "").trim();
    if (cellValue === String(leadId).trim()) {
      return i + 1; // 1-indexed
    }
  }
  return null;
}

/**
 * Write to a specific cell range in Opportunities or Archive.
 */
export async function writeCell(
  range: string,
  value: string | number
): Promise<void> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[String(value)]] },
  });
}

/**
 * Write a row range (multiple cells in one row).
 */
export async function writeRow(
  range: string,
  values: (string | number)[]
): Promise<void> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values.map(String)] },
  });
}

/**
 * Read a single cell's current value (used for note appends).
 */
export async function readCell(range: string): Promise<string> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return String(data.values?.[0]?.[0] ?? "");
}

/**
 * Read an entire row (used by Won/Lost archival to copy data to Archive).
 */
export async function readRow(range: string): Promise<string[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return (data.values?.[0] || []).map((v) => String(v ?? ""));
}

/**
 * Clear a row range.
 */
export async function clearRange(range: string): Promise<void> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range,
  });
}

/**
 * Find the first empty row in Archive (for appending Won/Lost archives).
 */
export async function findFirstEmptyArchiveRow(): Promise<number> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Archive!A1:A1000",
  });
  const rows = data.values || [];
  // Find last filled row, return next
  let lastFilled = 1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? "").trim()) {
      lastFilled = i + 1;
    }
  }
  return lastFilled + 1;
}

export const SPREADSHEET_ID = SHEET_ID;

const VALID_PRODUCTION_STATUS: ProductionStatus[] = [
  "Scheduled",
  "Power Washed",
  "Colors Picked",
  "In Production",
  "Complete",
];

const VALID_MOVABILITY: Movability[] = ["Flexible", "Window", "Immovable"];

function parseWashStatus(s: string): WashStatus {
  const t = (s || "").trim();
  if (!t) return "";
  if (/^na|n\/a$/i.test(t)) return "NA";
  if (/not.?sched/i.test(t)) return "Not Scheduled";
  if (/yes.?sched/i.test(t)) return "Yes Scheduled";
  if (/complete|done|^yes$/i.test(t)) return "Complete";
  return "";
}

function parseColorsStatus(s: string): ColorsStatus {
  const t = (s || "").trim();
  if (!t) return "";
  if (/match.?req|match required/i.test(t)) return "Match Required";
  if (/sample.?req|sample required/i.test(t)) return "Sample Required";
  if (/codes from client|codes/i.test(t)) return "Codes from Client";
  if (/confirmed.?colou?rs?|^yes$/i.test(t)) return "Confirmed Colours";
  return "";
}

function rowToProductionJob(row: string[]): ProductionJob | null {
  const [
    jobId,
    name,
    phone,
    email,
    address,
    bookedValueRaw,
    crew,
    startDate,
    endDate,
    estHours,
    status,
    movability,
    windowStart,
    windowEnd,
    powerWashDone,
    powerWashDate,
    colorsPicked,
    colorsPickedDate,
    materialsOrderedDate,
    notes,
    lastClientTouch,
    nextClientTouch,
    lawnSignUpDate,
    lawnSignDownDate,
    invoiceSentDate,
    reviewRequestedDate,
    reviewReceivedDate,
    reviewStarsOrUrl,
    scope,
    crewStatus,
    punchListRaw,
    autoConfirmRaw,
    confirmationSentDate,
  ] = row;

  const trimmedName = (name || "").trim();
  if (!trimmedName) return null;

  const trimmedStatus = (status || "Scheduled").trim();
  const normStatus: ProductionStatus | "Unknown" =
    (VALID_PRODUCTION_STATUS as string[]).includes(trimmedStatus)
      ? (trimmedStatus as ProductionStatus)
      : "Unknown";

  const trimmedMov = (movability || "Flexible").trim();
  const normMov: Movability = (VALID_MOVABILITY as string[]).includes(trimmedMov)
    ? (trimmedMov as Movability)
    : "Flexible";

  return {
    jobId: (jobId || "").trim(),
    name: trimmedName,
    phone: (phone || "").trim(),
    email: (email || "").trim(),
    address: (address || "").trim(),
    bookedValue: parseCurrency(bookedValueRaw || ""),
    bookedValueRaw: (bookedValueRaw || "").trim(),
    crew: (crew || "").trim(),
    startDate: parseDate(startDate || ""),
    endDate: parseDate(endDate || ""),
    estHours: parseDecimal(estHours || ""),
    status: normStatus,
    movability: normMov,
    windowStart: parseDate(windowStart || ""),
    windowEnd: parseDate(windowEnd || ""),
    washStatus: parseWashStatus(powerWashDone || ""),
    washDate: parseDate(powerWashDate || ""),
    colorsStatus: parseColorsStatus(colorsPicked || ""),
    colorsDate: parseDate(colorsPickedDate || ""),
    materialsOrderedDate: parseDate(materialsOrderedDate || ""),
    notes: (notes || "").trim(),
    lastClientTouch: parseDate(lastClientTouch || ""),
    nextClientTouch: parseDate(nextClientTouch || ""),
    lawnSignUpDate: parseDate(lawnSignUpDate || ""),
    lawnSignDownDate: parseDate(lawnSignDownDate || ""),
    invoiceSentDate: parseDate(invoiceSentDate || ""),
    reviewRequestedDate: parseDate(reviewRequestedDate || ""),
    reviewReceivedDate: parseDate(reviewReceivedDate || ""),
    reviewStarsOrUrl: (reviewStarsOrUrl || "").trim(),
    scope: (scope || "").trim(),
    crewStatus: normalizeCrewStatus(crewStatus || ""),
    punchList: parsePunchList(punchListRaw || ""),
    // Auto-confirm defaults to TRUE (opt-out, not opt-in) — most clients
    // should receive a confirmation. Only "no" / "false" turns it off.
    autoConfirm: !["no", "false", "off"].includes((autoConfirmRaw || "").trim().toLowerCase()),
    confirmationSentDate: parseDate(confirmationSentDate || ""),
  };
}

// Punch list is stored as a JSON array in column AE. Tolerant parser:
// returns empty array on missing, invalid JSON, or wrong shape.
function parsePunchList(raw: string): import("./types").PunchItem[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object" && typeof x.text === "string")
      .map((x, i) => ({
        id: typeof x.id === "string" && x.id ? x.id : `p${i}`,
        text: String(x.text),
        done: Boolean(x.done),
      }));
  } catch {
    return [];
  }
}

function normalizeCrewStatus(s: string): CrewStatus {
  const t = (s || "").trim().toLowerCase();
  if (t === "offered") return "Offered";
  if (t === "confirmed") return "Confirmed";
  return "Not Offered";
}

export async function fetchProduction(): Promise<ProductionJob[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: PRODUCTION_RANGE,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = data.values || [];
  return rows
    .map((r) => rowToProductionJob(r as string[]))
    .filter((x): x is ProductionJob => x !== null);
}

/** Find the row of a Production job by jobId. */
export async function findProductionRowByJobId(jobId: string): Promise<number | null> {
  return findRowByLeadId(jobId, "Production" as never as "Opportunities");
}

/** Append a new Production row (used by Mark Won flow). */
/**
 * Crew data (manual crew columns + per-day availability blocks) is stored
 * as a single JSON blob in Settings!B14 so it's shared across all users
 * of the dashboard (Jared + PM + future hires). Schema:
 *   { manualCrews: string[], blocks: Record<"crew::dayISO", reason> }
 *
 * Why a single cell vs separate tabs:
 *  - Atomic read/write — no consistency issues
 *  - One source of truth for crew config
 *  - Easier to evolve schema without sheet migrations
 *
 * If reading fails (cell empty, bad JSON), returns empty defaults so
 * the UI degrades gracefully and never crashes on stale state.
 */
export interface CrewData {
  manualCrews: string[];
  blocks: Record<string, string>;
}

const CREW_DATA_RANGE = "Settings!B14";

export async function fetchCrewData(): Promise<CrewData> {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: CREW_DATA_RANGE,
    });
    const raw = data.values?.[0]?.[0] ?? "";
    if (!raw || typeof raw !== "string") {
      return { manualCrews: [], blocks: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      manualCrews: Array.isArray(parsed.manualCrews) ? parsed.manualCrews : [],
      blocks: typeof parsed.blocks === "object" && parsed.blocks ? parsed.blocks : {},
    };
  } catch {
    return { manualCrews: [], blocks: {} };
  }
}

export async function writeCrewData(data: CrewData): Promise<void> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: CREW_DATA_RANGE,
    valueInputOption: "RAW",
    requestBody: { values: [[JSON.stringify(data)]] },
  });
}

/**
 * Rename a crew across the entire Production tab. Reads column G (crew),
 * finds every row whose value matches `oldName` (case-insensitive trim
 * compare), and rewrites those cells with `newName` in a single batch
 * update. Returns the count of rows changed so the UI can confirm.
 */
export async function bulkRenameCrew(
  oldName: string,
  newName: string
): Promise<{ updated: number }> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Production!G2:G1000",
  });
  const rows = data.values || [];
  const oldKey = oldName.trim().toLowerCase();
  const targets: string[] = [];
  rows.forEach((r, i) => {
    const v = (r[0] || "").trim();
    if (v.toLowerCase() === oldKey) {
      // i = 0 → row 2 in sheet (data starts at row 2)
      targets.push(`Production!G${i + 2}`);
    }
  });
  if (targets.length === 0) return { updated: 0 };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: targets.map((range) => ({ range, values: [[newName]] })),
    },
  });
  return { updated: targets.length };
}

export async function appendProductionRow(values: string[]): Promise<{ row: number }> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Find first empty row in Production tab
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Production!A1:A1000",
  });
  const rows = data.values || [];
  let lastFilled = 1; // header
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? "").trim()) lastFilled = i + 1;
  }
  const nextRow = lastFilled + 1;
  // Range must match the full schema width (A:AG, 33 cols) — createProductionJob
  // writes 33 values including Scope (AC), Crew Status (AD), Punch List (AE),
  // Auto-Confirm (AF), Confirmation Sent (AG). Previously the range stopped
  // at AB and the API rejected the row (2026-05-12 bug).
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Production!A${nextRow}:AG${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values.map(String)] },
  });
  return { row: nextRow };
}

function normStage(s: string): Stage {
  const trimmed = (s || "").trim();
  if (VALID_STAGES.includes(trimmed as Stage)) return trimmed as Stage;
  if (/^verbal/i.test(trimmed)) return "Verbal Yes";
  if (/^on.?hold/i.test(trimmed)) return "On Hold";
  if (/long.?term/i.test(trimmed)) return "Long-Term";
  if (/proposal/i.test(trimmed)) return "Proposal Sent";
  // Older sheet stages — roll into On Hold so the lead still appears (Jared
  // can decide later whether to truly archive it). Pre-estimate stages
  // (Set-Up Call / Estimate Booked / Estimate Done / Estimate Scheduled)
  // shouldn't normally exist in this dashboard's data per Jared's workflow.
  if (/^cold/i.test(trimmed)) return "On Hold";
  if (/estimate scheduled/i.test(trimmed)) return "On Hold";
  if (/estimate done|estimate complete/i.test(trimmed)) return "Proposal Sent";
  if (/^won/i.test(trimmed)) return "Won";
  if (/^lost/i.test(trimmed)) return "Lost";
  if (/^archived/i.test(trimmed)) return "Archived";
  return "Unknown";
}

function parsePromise(s: string): boolean {
  const t = (s || "").trim().toUpperCase();
  return t === "YES" || t === "Y" || t === "TRUE";
}

function rowToOpportunity(row: string[]): Opportunity | null {
  const [
    id,
    name,
    phone,
    email,
    address,
    leadSource,
    stage,
    estValueRaw,
    estDate,
    proposalDate,
    lastTouchDate,
    lastTouchType,
    nextFollowUpDate,
    nextFollowUpType,
    promise,
    promisedTime,
    nurtureStep,
    priorityScore,
    notes,
    dripJobsLink,
    daysSinceLastTouch,
    draftReady,
    lastUpdated,
    lastEmailSent,
    lastEmailReceived,
    lastEmailSnippet,
    phase,
    callAttempts,
    spouseAtEstimate,
    notesSummary,
    todoListRaw,
  ] = row;

  const trimmedName = (name || "").trim();
  if (!trimmedName) return null;
  // Filter test rows
  if (/^TEST\b/i.test(trimmedName)) return null;

  // Filter pre-estimate stages — per Jared's workflow, leads only enter this
  // dashboard AFTER the estimate is done. Anything still in Set-Up Call /
  // Estimate Booked / Estimate Scheduled is pre-opportunity and shouldn't
  // appear here. (The briefing ingestion should also be updated to never
  // import these in the first place — see cc-daily-lead-briefing skill.)
  const rawStage = (stage || "").trim();
  if (/set.?up|estimate booked|estimate scheduled/i.test(rawStage)) return null;

  return {
    id: (id || "").trim(),
    name: trimmedName,
    phone: (phone || "").replace(/^'/, "").trim(),
    email: (email || "").trim(),
    address: (address || "").trim(),
    leadSource: (leadSource || "").trim(),
    stage: normStage(stage || ""),
    estValue: parseCurrency(estValueRaw || ""),
    estValueRaw: (estValueRaw || "").trim(),
    estDate: parseDate(estDate || ""),
    proposalDate: parseDate(proposalDate || ""),
    lastTouchDate: parseDate(lastTouchDate || ""),
    lastTouchType: (lastTouchType || "").trim(),
    nextFollowUpDate: parseDate(nextFollowUpDate || ""),
    nextFollowUpType: (nextFollowUpType || "").trim(),
    promise: parsePromise(promise || ""),
    promisedTime: (promisedTime || "").trim(),
    nurtureStep: (nurtureStep || "").trim(),
    priorityScore: parseInteger(priorityScore || "") ?? 0,
    notes: (notes || "").trim(),
    dripJobsLink: (dripJobsLink || "").trim(),
    daysSinceLastTouch: parseInteger(daysSinceLastTouch || ""),
    draftReady: (draftReady || "").trim(),
    lastUpdated: (lastUpdated || "").trim(),
    lastEmailSent: (lastEmailSent || "").trim(),
    lastEmailReceived: (lastEmailReceived || "").trim(),
    lastEmailSnippet: (lastEmailSnippet || "").trim(),
    phase: (phase || "").trim(),
    callAttempts: parseInteger(callAttempts || ""),
    spouseAtEstimate: (spouseAtEstimate || "").trim(),
    notesSummary: (notesSummary || "").trim(),
    todoList: parseOppTodoList(todoListRaw || ""),
  };
}

// Parse the JSON-serialized to-do list stored in column AE. Same shape
// as ProductionJob.punchList — `[{id, text, done}]`. Defensive: empty
// strings, malformed JSON, and non-array payloads all yield `[]` so a
// bad cell never breaks the page render.
function parseOppTodoList(raw: string): import("./types").TodoItem[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object" && typeof x.text === "string")
      .map((x, i) => ({
        id: typeof x.id === "string" && x.id ? x.id : `t${i}`,
        text: String(x.text),
        done: Boolean(x.done),
      }));
  } catch {
    return [];
  }
}

export async function fetchOpportunities(): Promise<Opportunity[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = data.values || [];
  return rows
    .map((r) => rowToOpportunity(r as string[]))
    .filter((x): x is Opportunity => x !== null);
}

function rowToArchive(row: string[]): ArchiveRecord | null {
  // Archive columns A-X:
  //  A id, B name, C phone, D email, E address, F lead source, G final stage,
  //  H est value, I est date, J proposal date, K last touch, L last touch type,
  //  M result, N result date, O days from estimate, P booked?, Q booked value,
  //  R reason lost, S nurture step, T total touches, U notes, V dripjobs link,
  //  W archive date, X last updated
  const [
    id,
    name,
    , // phone
    , // email
    address,
    , // lead source
    finalStage,
    estValueRaw,
    estDateRaw,
    , // proposal date
    , // last touch
    , // last touch type
    result,
    resultDate,
    , // days from estimate
    , // booked?
    bookedValueRaw,
    reasonLostRaw,
  ] = row;
  const reasonLost = (reasonLostRaw || "").trim();

  if (!name?.trim()) return null;
  const r = (result || finalStage || "").trim();
  const normalizedResult: ArchiveRecord["result"] =
    /won/i.test(r) ? "Won" : /lost/i.test(r) ? "Lost" : "Other";

  return {
    id: (id || "").trim(),
    name: name.trim(),
    address: (address || "").trim(),
    result: normalizedResult,
    resultDate: parseDate(resultDate || ""),
    estDate: parseDate(estDateRaw || ""),
    estValue: parseCurrency(estValueRaw || ""),
    bookedValue: parseCurrency(bookedValueRaw || ""),
    finalStage: (finalStage || "").trim(),
    reasonLost,
  };
}

// ============================================================================
// LEADS — pre-estimate funnel. New "Leads" tab on the same sheet, 25 cols A-Y.
// Schema reference in lib/types.ts.
// ============================================================================

function parseBool(s: string): boolean {
  const t = (s || "").trim().toLowerCase();
  return t === "yes" || t === "y" || t === "true" || t === "1";
}

function normLeadStage(s: string): LeadStage | "Unknown" {
  const trimmed = (s || "").trim();
  if ((LEAD_STAGES as string[]).includes(trimmed)) return trimmed as LeadStage;
  // Tolerant fallbacks for legacy values / typos
  if (/^new/i.test(trimmed)) return "New";
  if (/attempt|trying/i.test(trimmed)) return "Attempted contact";
  if (/callback/i.test(trimmed)) return "Callback requested";
  if (/estimate.?booked|booked/i.test(trimmed)) return "Estimate booked";
  if (/long.?term|hold/i.test(trimmed)) return "Long-term hold";
  if (/lost|dead|disqualified/i.test(trimmed)) return "Lost";
  return "Unknown";
}

function rowToLead(row: string[]): Lead | null {
  const [
    id,
    name,
    phone,
    email,
    address,
    leadSource,
    stage,
    firstInquiryDate,
    stageDate,
    callbackTime,
    estimateVisitDate,
    originalEstimateDate,
    rescheduleCount,
    setupCallDone,
    setupCallDate,
    longTermReachOutDate,
    lastTouchDate,
    lastTouchType,
    nextTouchDate,
    nextTouchType,
    contactAttempts,
    notes,
    dripJobsLink,
    lostReason,
    lastUpdated,
  ] = row;

  const trimmedName = (name || "").trim();
  if (!trimmedName) return null;
  if (/^TEST\b/i.test(trimmedName)) return null;

  return {
    id: (id || "").trim(),
    name: trimmedName,
    phone: (phone || "").replace(/^'/, "").trim(),
    email: (email || "").trim(),
    address: (address || "").trim(),
    leadSource: (leadSource || "").trim(),
    stage: normLeadStage(stage || ""),
    firstInquiryDate: parseDate(firstInquiryDate || ""),
    stageDate: parseDate(stageDate || ""),
    callbackTime: (callbackTime || "").trim(),
    estimateVisitDate: parseDate(estimateVisitDate || ""),
    originalEstimateDate: parseDate(originalEstimateDate || ""),
    rescheduleCount: parseInteger(rescheduleCount || "") ?? 0,
    setupCallDone: parseBool(setupCallDone || ""),
    setupCallDate: parseDate(setupCallDate || ""),
    longTermReachOutDate: parseDate(longTermReachOutDate || ""),
    lastTouchDate: parseDate(lastTouchDate || ""),
    lastTouchType: (lastTouchType || "").trim(),
    nextTouchDate: parseDate(nextTouchDate || ""),
    nextTouchType: (nextTouchType || "").trim(),
    contactAttempts: parseInteger(contactAttempts || "") ?? 0,
    notes: (notes || "").trim(),
    dripJobsLink: (dripJobsLink || "").trim(),
    lostReason: (lostReason || "").trim(),
    lastUpdated: (lastUpdated || "").trim(),
  };
}

export async function fetchLeads(): Promise<Lead[]> {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: LEADS_RANGE,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const rows = data.values || [];
    return rows
      .map((r) => rowToLead(r as string[]))
      .filter((x): x is Lead => x !== null);
  } catch (err) {
    // If the Leads tab doesn't exist yet, return empty rather than throwing.
    // Lets the dashboard render with an "Initialise Leads tab" prompt.
    const msg = err instanceof Error ? err.message : "";
    if (/Unable to parse range|not found|Requested entity was not found/i.test(msg)) {
      return [];
    }
    throw err;
  }
}

/** Find row number for a lead by ID in the Leads tab. */
export async function findLeadRowById(leadId: string): Promise<number | null> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Leads!A1:A1000",
  });
  const rows = data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const cellValue = String(rows[i]?.[0] ?? "").trim();
    if (cellValue === String(leadId).trim()) {
      return i + 1;
    }
  }
  return null;
}

/** Append a new lead row. Returns the assigned row number. */
export async function appendLeadRow(values: string[]): Promise<{ row: number; id: string }> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Leads!A1:A1000",
  });
  const rows = data.values || [];
  let lastFilled = 1;
  let maxId = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = String(rows[i]?.[0] ?? "").trim();
    if (v) {
      lastFilled = i + 1;
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > maxId) maxId = n;
    }
  }
  const nextRow = lastFilled + 1;
  const id = values[0] && String(values[0]).trim() ? String(values[0]) : String(maxId + 1);
  const finalValues = [id, ...values.slice(1)];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Leads!A${nextRow}:Y${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [finalValues.map(String)] },
  });
  return { row: nextRow, id };
}

/**
 * Initialise the Leads tab if it doesn't exist — creates the tab + writes
 * the 25-column header row. Idempotent: if the tab already exists, does
 * nothing. Called by /api/leads/init endpoint.
 */
export async function initLeadsTab(): Promise<{ created: boolean }> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === "Leads");
  if (exists) return { created: false };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: "Leads",
              gridProperties: { rowCount: 1000, columnCount: 25 },
            },
          },
        },
      ],
    },
  });
  const HEADERS = [
    "ID",
    "Name",
    "Phone",
    "Email",
    "Address",
    "Lead Source",
    "Stage",
    "First Inquiry Date",
    "Stage Date",
    "Callback Time",
    "Estimate Visit Date",
    "Original Estimate Date",
    "Reschedule Count",
    "Setup Call Done",
    "Setup Call Date",
    "Long-Term Reach-Out Date",
    "Last Touch Date",
    "Last Touch Type",
    "Next Touch Date",
    "Next Touch Type",
    "Contact Attempts",
    "Notes",
    "DripJobs Link",
    "Lost Reason",
    "Last Updated",
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Leads!A1:Y1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS] },
  });
  return { created: true };
}

export async function fetchArchive(): Promise<ArchiveRecord[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: ARCHIVE_RANGE,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = data.values || [];
  return rows
    .map((r) => rowToArchive(r as string[]))
    .filter((x): x is ArchiveRecord => x !== null);
}

// ============================================================================
// ESTIMATE POINTS — unified address feed for the Map view.
// Combines active Opportunities (every stage = estimate was completed, per
// the Opportunities sheet rule) with Archive Lost (estimate done, didn't
// book). EXCLUDES Archive Won because those land in Production and the
// map already pins them via the Booked layer — including Won here would
// double-pin every booked job.
// ============================================================================

export async function fetchEstimatePoints(): Promise<EstimatePoint[]> {
  // Need active Production too — used to dedupe Archive Won entries
  // that are still in Production (so a Won job doesn't double-pin
  // across Booked + Estimates layers).
  const [opps, archive, production] = await Promise.all([
    fetchOpportunities(),
    fetchArchive(),
    fetchProduction(),
  ]);

  const productionIds = new Set<string>();
  const productionNames = new Set<string>();
  for (const p of production) {
    if (p.jobId) productionIds.add(p.jobId.toLowerCase().trim());
    if (p.name) productionNames.add(p.name.toLowerCase().trim());
  }

  const points: EstimatePoint[] = [];

  for (const o of opps) {
    if (!o.address || !o.address.trim()) continue;
    points.push({
      id: o.id || o.name,
      name: o.name,
      address: o.address,
      stage: o.stage,
      estValue: o.estValue,
      estDate: o.estDate,
      proposalDate: o.proposalDate,
      resultDate: null,
      source: "opportunity",
    });
  }

  for (const a of archive) {
    if (!a.address || !a.address.trim()) continue;
    // Skip Archive Won if it's STILL in active Production (avoids double pin)
    if (a.result === "Won") {
      const nameLower = a.name.toLowerCase().trim();
      const idLower = (a.id || "").toLowerCase().trim();
      if (productionNames.has(nameLower) || (idLower && productionIds.has(idLower))) {
        continue;
      }
    }
    if (a.result !== "Lost" && a.result !== "Won") continue;
    points.push({
      id: a.id || a.name,
      name: a.name,
      address: a.address,
      stage: a.result,
      estValue: a.estValue,
      estDate: a.estDate,
      proposalDate: null,
      resultDate: a.resultDate,
      source: a.result === "Won" ? "archive-won" : "archive-lost",
    });
  }

  return points;
}
