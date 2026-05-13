// Opportunity row from the CC Lead Tracker Google Sheet (Opportunities tab)
// Sheet ID: YOUR_SHEET_ID_HERE
// Schema reference (29 columns A-AC):
//   ID, Name, Phone, Email, Address, Lead Source, Stage, Est Value, Est Date,
//   Proposal Date, Last Touch Date, Last Touch Type, Next Follow-Up Date,
//   Next Follow-Up Type, Promise?, Promised Time, Nurture Step, Priority Score,
//   Notes, DripJobs Link, Days Since Last Touch, Draft Ready?, Last Updated,
//   Last Email Sent, Last Email Received, Last Email Snippet, Phase (1-4),
//   Call Attempts, Spouse at Estimate?

import type { Heat, HeatTier } from "./heat";

export interface Opportunity {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  leadSource: string;
  stage: Stage;
  estValue: number;
  estValueRaw: string;
  estDate: string | null;
  proposalDate: string | null;
  lastTouchDate: string | null;
  lastTouchType: string;
  nextFollowUpDate: string | null;
  nextFollowUpType: string;
  promise: boolean;
  promisedTime: string;
  nurtureStep: string;
  priorityScore: number;
  notes: string;
  dripJobsLink: string;
  daysSinceLastTouch: number | null;
  draftReady: string;
  lastUpdated: string;
  lastEmailSent: string;
  lastEmailReceived: string;
  lastEmailSnippet: string;
  phase: string;
  callAttempts: number | null;
  spouseAtEstimate: string;
  notesSummary: string;  // Column AD — AI-generated 2-3 bullet summary, refreshed by daily briefing
  todoList: TodoItem[];  // Column AE — JSON array of {id, text, done} per the punchList pattern
}

// Per-opportunity structured to-do (parallel to ProductionJob.punchList).
// Stored as JSON in column AE on the Opportunities sheet so Jared and his
// production manager can both add/check items, and the card shows an
// at-a-glance badge when there are outstanding to-dos. Distinct from
// Notes (the timestamped human log) and System Activity (auto event log).
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ScoredOpportunity extends Opportunity {
  heat: Heat;
}

// Real stages used on the Opportunity dashboard. Per Jared's workflow:
// leads only land here AFTER estimate is done (and proposal is auto-sent
// at the same moment via DripJobs). So Set-Up Call / Estimate Booked /
// Estimate Done don't exist as opportunity stages on this view.
export type Stage =
  | "Proposal Sent"
  | "Verbal Yes"
  | "On Hold"
  | "Long-Term"
  | "Won"
  | "Lost"
  | "Archived"
  | "Unknown";

export type DateBucketKey =
  | "overdue"
  | "today"
  | "next7"
  | "next14"
  | "next30"
  | "next90"
  | "unscheduled";

export interface DateBucket {
  key: DateBucketKey;
  label: string;
  defaultExpanded: boolean;
  opportunities: ScoredOpportunity[];
  totalValue: number;
}

export interface HeatBucket {
  key: HeatTier;
  opportunities: ScoredOpportunity[];
  totalValue: number;
}

export interface ActionZone {
  overdue: ScoredOpportunity[];
  today: ScoredOpportunity[];
  tomorrow: ScoredOpportunity[];
}

export interface PipelineHealth {
  activeCount: number;
  pipelineValue: number;
  weeklyTrend: { date: string; value: number }[];
  heatDistribution: Record<HeatTier, { count: number; value: number }>;
  winRateLast30d: number | null;
  avgDaysToClose: number | null;
  thisWeekBookings: number;
  thisWeekBookingsValue: number;
  thisMonthBookingsValue: number;
  promisesPending: number;
  rotting: number;
}

export interface ArchiveRecord {
  id: string;
  name: string;
  address: string;                 // Estimate address (col E) — preserved for map view
  result: "Won" | "Lost" | "Other";
  resultDate: string | null;       // YYYY-MM-DD
  estDate: string | null;          // YYYY-MM-DD — when estimate was completed (col I)
  estValue: number;
  bookedValue: number;             // 0 if not logged
  finalStage: string;
  reasonLost: string;              // Categorical reason when result=Lost (Price, Timing, etc.)
}

// Estimate point for the Map view — unified shape pulled from both
// active Opportunities and Archive (Lost + Won, with Won deduped against
// active Production). Carries proposalDate + resultDate for year-filter
// fallback when estDate is empty.
export interface EstimatePoint {
  id: string;
  name: string;
  address: string;
  stage: string;                   // Opportunity stage OR "Lost"/"Won" for archived
  estValue: number;
  estDate: string | null;
  proposalDate: string | null;     // Fallback for year-filter
  resultDate: string | null;       // Fallback for year-filter (Won/Lost archive entries)
  source: "opportunity" | "archive-lost" | "archive-won";
}

export type ProductionStatus =
  | "Scheduled"
  | "Power Washed"
  | "Colors Picked"
  | "In Production"
  | "Complete";

export type Movability = "Flexible" | "Window" | "Immovable";

export type WashStatus = "" | "NA" | "Not Scheduled" | "Yes Scheduled" | "Complete";
export type ColorsStatus =
  | ""
  | "Match Required"
  | "Sample Required"
  | "Codes from Client"
  | "Confirmed Colours";

export interface ProductionJob {
  jobId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  bookedValue: number;
  bookedValueRaw: string;
  crew: string;
  startDate: string | null;     // YYYY-MM-DD
  endDate: string | null;
  estHours: number | null;
  status: ProductionStatus | "Unknown";
  movability: Movability;
  windowStart: string | null;
  windowEnd: string | null;
  washStatus: WashStatus;
  washDate: string | null;
  colorsStatus: ColorsStatus;
  colorsDate: string | null;
  materialsOrderedDate: string | null;
  notes: string;
  lastClientTouch: string | null;
  nextClientTouch: string | null;
  lawnSignUpDate: string | null;
  lawnSignDownDate: string | null;
  invoiceSentDate: string | null;
  reviewRequestedDate: string | null;
  reviewReceivedDate: string | null;
  reviewStarsOrUrl: string;
  scope: string;  // Project-defining scope notes for the crew (not timestamped)
  crewStatus: CrewStatus;  // Whether the job has been offered to / accepted by a crew
  punchList: PunchItem[];  // Structured checklist surfaced on iCal feed
  autoConfirm: boolean;   // Whether to surface this job in auto-confirmation banner (default true)
  confirmationSentDate: string | null;  // ISO date when client confirmation was sent
}

export type CrewStatus = "Not Offered" | "Offered" | "Confirmed";

export interface PunchItem {
  id: string;
  text: string;
  done: boolean;
}

export interface DashboardData {
  all: ScoredOpportunity[];
  active: ScoredOpportunity[];
  archive: ArchiveRecord[];
  actionZone: ActionZone;
  heatBuckets: HeatBucket[];
  dateBuckets: DateBucket[];
  health: PipelineHealth;
  headline: import("./insights").Headline;
  smartInsights: import("./insights").SmartInsight[];
  funnel: import("./insights").FunnelStage[];
  generatedAt: string;
}

// ============================================================================
// LEADS DASHBOARD — pre-estimate stage (cold inquiry → estimate done →
// auto-promote to Pipeline). Schema mirrors the "Leads" tab on the same
// Google Sheet (YOUR_SHEET_ID_HERE).
//
// 25 columns A-Y:
//   A ID, B Name, C Phone, D Email, E Address, F Lead Source, G Stage,
//   H First Inquiry Date, I Stage Date, J Callback Time, K Estimate Visit Date,
//   L Original Estimate Date, M Reschedule Count, N Setup Call Done,
//   O Setup Call Date, P Long-Term Reach-Out Date, Q Last Touch Date,
//   R Last Touch Type, S Next Touch Date, T Next Touch Type,
//   U Contact Attempts, V Notes, W DripJobs Link, X Lost Reason, Y Last Updated
//
// NO Est Value column — value isn't known until in-person quote (lives in
// Opportunities tab only).
// ============================================================================

export type LeadStage =
  | "New"
  | "Attempted contact"
  | "Callback requested"
  | "Estimate booked"
  | "Long-term hold"
  | "Lost";

export type LeadSource =
  | "Google"
  | "Website"
  | "Facebook"
  | "Instagram"
  | "Referral"
  | "Word of Mouth"
  | "Repeat Customer"
  | "Door to Door Canvassing"
  | "Door Hanger"
  | "Flyer and Mail"
  | "Job Site Marketing"
  | "Yard Sign"
  | "Company Vehicle"
  | "Email"
  | "Other"
  | "Call Centre";

export const LEAD_SOURCES: LeadSource[] = [
  "Google",
  "Website",
  "Facebook",
  "Instagram",
  "Referral",
  "Word of Mouth",
  "Repeat Customer",
  "Door to Door Canvassing",
  "Door Hanger",
  "Flyer and Mail",
  "Job Site Marketing",
  "Yard Sign",
  "Company Vehicle",
  "Email",
  "Other",
  "Call Centre",
];

export const LEAD_STAGES: LeadStage[] = [
  "New",
  "Attempted contact",
  "Callback requested",
  "Estimate booked",
  "Long-term hold",
  "Lost",
];

export type LeadLostReason =
  | "Unresponsive"
  | "Disqualified"
  | "DIY"
  | "Out of territory"
  | "Competitor pre-quote"
  | "Bad fit"
  | "Other";

export const LEAD_LOST_REASONS: LeadLostReason[] = [
  "Unresponsive",
  "Disqualified",
  "DIY",
  "Out of territory",
  "Competitor pre-quote",
  "Bad fit",
  "Other",
];

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  leadSource: string;
  stage: LeadStage | "Unknown";
  firstInquiryDate: string | null;
  stageDate: string | null;
  callbackTime: string;                  // Free text "Mon 3pm" or ISO datetime
  estimateVisitDate: string | null;
  originalEstimateDate: string | null;
  rescheduleCount: number;
  setupCallDone: boolean;
  setupCallDate: string | null;
  longTermReachOutDate: string | null;
  lastTouchDate: string | null;
  lastTouchType: string;
  nextTouchDate: string | null;
  nextTouchType: string;
  contactAttempts: number;
  notes: string;
  dripJobsLink: string;
  lostReason: string;
  lastUpdated: string;
}

export interface ScoredLead extends Lead {
  priorityScore: number;
  priorityReasons: string[];             // 1-3 short reasons fed the score
  staleSignals: LeadStaleSignal[];       // Active stale signals
}

export type LeadStaleSignalKey =
  | "never-reached"
  | "inbound-today"
  | "ghost-candidate"
  | "callback-due"
  | "setup-call-pending"
  | "estimate-didnt-happen"
  | "day-before-confirmation"
  | "long-term-reachout-due"
  | "estimate-pending-long"
  | "reschedule-prone"
  | "stale-generic";

export interface LeadStaleSignal {
  key: LeadStaleSignalKey;
  label: string;
  severity: "rose" | "amber";
  reason: string;                        // Short tooltip
}

export interface LeadsHealth {
  activeCount: number;
  byStage: Record<LeadStage, number>;
  // Click-to-expand attention stats
  callbackDue: number;
  neverReached: number;
  inboundToday: number;
  ghosting: number;
  estimateThisWeek: number;
  setupCallsPending: number;
  longTermReachoutsDue: number;
  stale: number;
}

export interface LeadsHeadline {
  emoji: string;
  text: string;
  tone: "danger" | "warning" | "good" | "neutral";
  relatedLabel: string;
  relatedLeads: ScoredLead[];
}

export interface LeadsDashboardData {
  all: ScoredLead[];
  active: ScoredLead[];                  // Excludes Lost
  topPicks: ScoredLead[];                // Top 3 by priority
  health: LeadsHealth;
  headline: LeadsHeadline;
  generatedAt: string;
}
