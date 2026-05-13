import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  appendLeadNote,
  archiveLeadAsLost,
  bulkCreateLeads,
  changeLeadStage,
  createLead,
  logLeadTouch,
  markSetupCallDone,
  rescheduleEstimate,
  snoozeLead,
} from "@/lib/leadsActions";
import { initLeadsTab } from "@/lib/sheets";
import type { LeadStage } from "@/lib/types";

type ActionBody =
  | { action: "init" }
  | { action: "touch"; leadId: string; type: "Call" | "VM" | "Email" | "Text" | "Note" }
  | { action: "snooze"; leadId: string; date: string; fuType?: "Call" | "Email" | "Text" }
  | { action: "note"; leadId: string; text: string }
  | {
      action: "stage";
      leadId: string;
      newStage: "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold";
      callbackTime?: string;
      estimateVisitDate?: string;
      longTermReachOutDate?: string;
    }
  | { action: "setup-call"; leadId: string; done: boolean }
  | { action: "reschedule"; leadId: string; newDate: string }
  | { action: "lost"; leadId: string; reason: string; note?: string }
  | {
      action: "create";
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      leadSource: string;
      stage?: "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold";
      firstInquiryDate?: string;
      notes?: string;
      dripJobsLink?: string;
    }
  | {
      action: "bulk-create";
      rows: Array<{
        name: string;
        phone?: string;
        email?: string;
        address?: string;
        leadSource?: string;
        stage?: "New" | "Attempted contact" | "Callback requested" | "Estimate booked" | "Long-term hold";
        firstInquiryDate?: string;
        notes?: string;
        dripJobsLink?: string;
      }>;
    };

export async function POST(req: NextRequest) {
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    let result: unknown;
    switch (body.action) {
      case "init":
        result = await initLeadsTab();
        break;
      case "touch":
        if (!body.leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
        result = await logLeadTouch(body.leadId, body.type);
        break;
      case "snooze":
        if (!body.leadId || !body.date) {
          return NextResponse.json({ error: "Missing leadId/date" }, { status: 400 });
        }
        result = await snoozeLead(body.leadId, body.date, body.fuType);
        break;
      case "note":
        if (!body.leadId || !body.text?.trim()) {
          return NextResponse.json({ error: "Missing leadId/text" }, { status: 400 });
        }
        result = await appendLeadNote(body.leadId, body.text);
        break;
      case "stage":
        if (!body.leadId || !body.newStage) {
          return NextResponse.json({ error: "Missing leadId/newStage" }, { status: 400 });
        }
        result = await changeLeadStage(body.leadId, body.newStage, {
          callbackTime: body.callbackTime,
          estimateVisitDate: body.estimateVisitDate,
          longTermReachOutDate: body.longTermReachOutDate,
        });
        break;
      case "setup-call":
        if (!body.leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
        result = await markSetupCallDone(body.leadId, body.done);
        break;
      case "reschedule":
        if (!body.leadId || !body.newDate) {
          return NextResponse.json({ error: "Missing leadId/newDate" }, { status: 400 });
        }
        result = await rescheduleEstimate(body.leadId, body.newDate);
        break;
      case "lost":
        if (!body.leadId || !body.reason) {
          return NextResponse.json({ error: "Missing leadId/reason" }, { status: 400 });
        }
        result = await archiveLeadAsLost(body.leadId, body.reason, body.note);
        break;
      case "create":
        if (!body.name?.trim() || !body.leadSource) {
          return NextResponse.json({ error: "Missing name/leadSource" }, { status: 400 });
        }
        result = await createLead({
          name: body.name,
          phone: body.phone,
          email: body.email,
          address: body.address,
          leadSource: body.leadSource,
          stage: body.stage,
          firstInquiryDate: body.firstInquiryDate,
          notes: body.notes,
          dripJobsLink: body.dripJobsLink,
        });
        break;
      case "bulk-create":
        if (!Array.isArray(body.rows) || body.rows.length === 0) {
          return NextResponse.json({ error: "Missing rows" }, { status: 400 });
        }
        if (body.rows.length > 2000) {
          return NextResponse.json({ error: "Max 2000 rows per import — split into batches" }, { status: 400 });
        }
        result = await bulkCreateLeads(body.rows as Array<{
          name: string;
          phone?: string;
          email?: string;
          address?: string;
          leadSource?: string;
          stage?: LeadStage;
          firstInquiryDate?: string;
          notes?: string;
          dripJobsLink?: string;
        }>);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    revalidatePath("/leads", "page");
    return NextResponse.json({ ok: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    console.error("Lead action error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
