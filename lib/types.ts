/**
 * Schema for the Mahogany & Hyde Operations Google Sheet.
 *
 * Three tabs: Opportunities, Production, TimeEntries.
 *
 * Adjust these column letters to match your actual sheet. The starter
 * assumes the column order below — if you reorder columns in the sheet,
 * update `lib/sheets.ts` parsers to match.
 */

export const OPPORTUNITY_STAGES = [
  "Initial Contact", // First touch with a designer or prospect
  "Phone Conversation", // We've had a real conversation
  "Quote Sent", // Estimate delivered, waiting on a decision
  "Verbal Yes", // They've said yes but no deposit / contract yet
  "Booked", // Deposit paid, moves to Production
  "Lost", // No-go (terminal)
  "On Hold", // Paused — revisit later
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export interface Opportunity {
  id: string;
  name: string; // Designer or client name
  stage: OpportunityStage;
  estValue: number;
  bookedValue: number;
  source: string; // designer / cold / past-client / referral / etc.
  lastTouchDate: string | null; // YYYY-MM-DD
  nextFollowUpDate: string | null;
  nextFollowUpType: string; // call / email / text / IG-comment
  notes: string;
  designerName: string;
}

export interface ProductionJob {
  id: string;
  name: string;
  bookedValue: number;
  materialsBudget: number;
  quotedHours: number;
  startDate: string | null;
  targetShipDate: string | null;
  status: "Scheduled" | "In Production" | "Complete";
  woodSpecies: string;
  finishType: string;
  notes: string;
}

export interface TimeEntry {
  id: string;
  user: string; // "Cody" | "Paul" | etc.
  jobId: string; // FK to ProductionJob.id
  task: string; // milling / glue-up / sanding / finishing / install
  startedAt: string; // ISO datetime
  endedAt: string | null; // ISO datetime, null while running
  units: number | null;
  unitType: string; // linear-ft / sq-ft / pieces
}

export interface DashboardData {
  active: Opportunity[];
  byBucket: Record<string, Opportunity[]>;
}
