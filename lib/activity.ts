import { google } from "googleapis";
import { SHEET_ID, getServiceAccountAuth } from "./sheets";

export interface ActivityEntry {
  timestamp: string;        // ISO datetime in PST
  jobId: string;            // "" for crew-level actions like renameCrew
  action: string;           // schedule | status | wash | colors | crewStatus | scope | punch | note | materials | touch | review | create | renameCrew
  detail: string;           // Human-readable summary
  actor: string;            // Default "Jared" until multi-user
}

const ACTIVITY_RANGE = "Activity!A:E";
const DEFAULT_ACTOR = "Jared";
const TZ = "America/Vancouver";

function nowVancouverISO(): string {
  // ISO-ish datetime in PST: YYYY-MM-DDTHH:MM:SS — sortable lexicographically.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Append an entry to the Activity tab. Fire-and-forget — never throws to
 * the caller. If the log write fails, we surface a console error but let
 * the main action succeed. (A failed log is much less bad than a failed
 * mutation that already happened.)
 */
export async function logActivity(
  jobId: string,
  action: string,
  detail: string,
  actor: string = DEFAULT_ACTOR
): Promise<void> {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: ACTIVITY_RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[nowVancouverISO(), jobId, action, detail, actor]],
      },
    });
  } catch (err) {
    console.error("logActivity failed:", err);
  }
}

/**
 * Fetch activity entries. Newest first. Optionally filtered by jobId.
 * Reads the full Activity sheet (cheap — typically <1000 rows for
 * months/years of usage) and filters in-memory.
 */
export async function fetchActivity(
  opts: { jobId?: string; limit?: number } = {}
): Promise<ActivityEntry[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Activity!A2:E10000",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = (data.values || []) as string[][];
  const entries: ActivityEntry[] = rows
    .filter((r) => r && r[0])
    .map((r) => ({
      timestamp: r[0] || "",
      jobId: r[1] || "",
      action: r[2] || "",
      detail: r[3] || "",
      actor: r[4] || DEFAULT_ACTOR,
    }));
  let filtered = entries;
  if (opts.jobId) filtered = filtered.filter((e) => e.jobId === opts.jobId);
  // Newest first (timestamp is ISO so lexicographic sort works).
  filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (opts.limit) filtered = filtered.slice(0, opts.limit);
  return filtered;
}
