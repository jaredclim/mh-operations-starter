import { google } from "googleapis";
import type { Opportunity, OpportunityStage, ProductionJob } from "./types";
import { OPPORTUNITY_STAGES } from "./types";
import { parseCurrency, parseDate, parseDecimal } from "./utils";

export const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const OPPORTUNITY_RANGE = "Opportunities!A2:L1000";
const PRODUCTION_RANGE = "Production!A2:L1000";

export function getServiceAccountAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var not set");
  const parsed = JSON.parse(raw);
  return new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function isValidStage(s: string): s is OpportunityStage {
  return (OPPORTUNITY_STAGES as readonly string[]).includes(s);
}

/**
 * Fetch every active Opportunity row from the sheet.
 *
 * Column mapping (A→L):
 *   A=id  B=name  C=stage  D=estValue  E=bookedValue  F=source
 *   G=lastTouchDate  H=nextFollowUpDate  I=nextFollowUpType
 *   J=notes  K=designerName  L=isTestRow
 *
 * Rows where K is "TEST" or where name is empty are skipped.
 */
export async function fetchOpportunities(): Promise<Opportunity[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: OPPORTUNITY_RANGE,
  });
  const rows = data.values || [];
  const out: Opportunity[] = [];
  for (const row of rows) {
    const id = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    if (!id || !name) continue;
    if (String(row[11] || "").toUpperCase() === "TEST") continue;
    const stageRaw = String(row[2] || "").trim();
    const stage: OpportunityStage = isValidStage(stageRaw)
      ? stageRaw
      : "Initial Contact";
    out.push({
      id,
      name,
      stage,
      estValue: parseCurrency(String(row[3] || "")),
      bookedValue: parseCurrency(String(row[4] || "")),
      source: String(row[5] || "").trim(),
      lastTouchDate: parseDate(String(row[6] || "")),
      nextFollowUpDate: parseDate(String(row[7] || "")),
      nextFollowUpType: String(row[8] || "").trim(),
      notes: String(row[9] || "").trim(),
      designerName: String(row[10] || "").trim(),
    });
  }
  return out;
}

/**
 * Fetch every Production row. Column mapping (A→L):
 *   A=id  B=name  C=bookedValue  D=materialsBudget  E=quotedHours
 *   F=startDate  G=targetShipDate  H=status  I=woodSpecies
 *   J=finishType  K=notes  L=isTestRow
 */
export async function fetchProduction(): Promise<ProductionJob[]> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: PRODUCTION_RANGE,
  });
  const rows = data.values || [];
  const out: ProductionJob[] = [];
  for (const row of rows) {
    const id = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    if (!id || !name) continue;
    if (String(row[11] || "").toUpperCase() === "TEST") continue;
    const statusRaw = String(row[7] || "").trim();
    const status: ProductionJob["status"] =
      statusRaw === "Complete" || statusRaw === "In Production"
        ? statusRaw
        : "Scheduled";
    out.push({
      id,
      name,
      bookedValue: parseCurrency(String(row[2] || "")),
      materialsBudget: parseCurrency(String(row[3] || "")),
      quotedHours: parseDecimal(String(row[4] || "")) || 0,
      startDate: parseDate(String(row[5] || "")),
      targetShipDate: parseDate(String(row[6] || "")),
      status,
      woodSpecies: String(row[8] || "").trim(),
      finishType: String(row[9] || "").trim(),
      notes: String(row[10] || "").trim(),
    });
  }
  return out;
}
