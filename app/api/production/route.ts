import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  appendProductionNote,
  createProductionJob,
  deleteProductionJob,
  logClientTouch,
  markConfirmationSent,
  renameCrew,
  updateBookedValue,
  updateClientTouches,
  updateAutoConfirm,
  updateColorsStatus,
  updateCrewStatus,
  updateMaterialsOrdered,
  updateMovability,
  updatePunchList,
  updateReview,
  updateSchedule,
  updateScope,
  updateStatus,
  updateWashStatus,
} from "@/lib/productionActions";

type Body =
  | { action: "schedule"; jobId: string; crew?: string; startDate?: string; endDate?: string; estHours?: number }
  | { action: "status"; jobId: string; status: "Scheduled" | "Power Washed" | "Colors Picked" | "In Production" | "Complete" }
  | { action: "movability"; jobId: string; movability: "Flexible" | "Window" | "Immovable"; windowStart?: string; windowEnd?: string }
  | { action: "wash"; jobId: string; status: "" | "NA" | "Not Scheduled" | "Yes Scheduled" | "Complete" }
  | { action: "colors"; jobId: string; status: "" | "Match Required" | "Sample Required" | "Codes from Client" | "Confirmed Colours" }
  | { action: "materials"; jobId: string; date: string }
  | { action: "note"; jobId: string; text: string }
  | { action: "scope"; jobId: string; scope: string }
  | { action: "value"; jobId: string; bookedValue: number }
  | { action: "crewStatus"; jobId: string; crewStatus: "Not Offered" | "Offered" | "Confirmed" }
  | { action: "punch"; jobId: string; items: { id: string; text: string; done: boolean }[] }
  | { action: "autoConfirm"; jobId: string; value: boolean }
  | { action: "confirmationSent"; jobId: string }
  | { action: "touch"; jobId: string; nextDays?: number }
  | { action: "touchDates"; jobId: string; lastDate?: string | null; nextDate?: string | null }
  | { action: "review"; jobId: string; requested?: boolean; received?: boolean; starsOrUrl?: string }
  | { action: "create"; jobId: string; name: string; phone?: string; email?: string; address?: string; bookedValue?: number; crew?: string; startDate?: string; endDate?: string; estHours?: number }
  | { action: "delete"; jobId: string }
  // Crew-level: doesn't carry a jobId because it spans many rows. Kept as
  // a separate route below to avoid the jobId requirement.
  | { action: "renameCrew"; oldName: string; newName: string };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }
  // Crew-level rename doesn't take a jobId; everything else does.
  if (body.action !== "renameCrew" && !("jobId" in body)) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  try {
    let result: unknown;
    switch (body.action) {
      case "schedule":
        result = await updateSchedule(body.jobId, {
          crew: body.crew,
          startDate: body.startDate,
          endDate: body.endDate,
          estHours: body.estHours,
        });
        break;
      case "status":
        result = await updateStatus(body.jobId, body.status);
        break;
      case "movability":
        result = await updateMovability(body.jobId, body.movability, body.windowStart, body.windowEnd);
        break;
      case "wash":
        result = await updateWashStatus(body.jobId, body.status);
        break;
      case "colors":
        result = await updateColorsStatus(body.jobId, body.status);
        break;
      case "materials":
        result = await updateMaterialsOrdered(body.jobId, body.date);
        break;
      case "note":
        if (!body.text?.trim()) return NextResponse.json({ error: "note requires text" }, { status: 400 });
        result = await appendProductionNote(body.jobId, body.text);
        break;
      case "scope":
        result = await updateScope(body.jobId, body.scope ?? "");
        break;
      case "value":
        if (typeof body.bookedValue !== "number" || !Number.isFinite(body.bookedValue) || body.bookedValue < 0) {
          return NextResponse.json({ error: "value requires bookedValue >= 0" }, { status: 400 });
        }
        result = await updateBookedValue(body.jobId, body.bookedValue);
        break;
      case "crewStatus":
        result = await updateCrewStatus(body.jobId, body.crewStatus);
        break;
      case "punch":
        if (!Array.isArray(body.items)) {
          return NextResponse.json({ error: "punch requires items array" }, { status: 400 });
        }
        result = await updatePunchList(body.jobId, body.items);
        break;
      case "autoConfirm":
        result = await updateAutoConfirm(body.jobId, body.value);
        break;
      case "confirmationSent":
        result = await markConfirmationSent(body.jobId);
        break;
      case "touch":
        result = await logClientTouch(body.jobId, body.nextDays);
        break;
      case "touchDates":
        result = await updateClientTouches(body.jobId, body.lastDate ?? null, body.nextDate ?? null);
        break;
      case "review":
        result = await updateReview(body.jobId, {
          requested: body.requested,
          received: body.received,
          starsOrUrl: body.starsOrUrl,
        });
        break;
      case "create":
        if (!body.name?.trim() || !body.jobId?.trim()) {
          return NextResponse.json({ error: "create requires jobId and name" }, { status: 400 });
        }
        result = await createProductionJob(body);
        break;
      case "delete":
        if (!body.jobId?.trim()) {
          return NextResponse.json({ error: "delete requires jobId" }, { status: 400 });
        }
        result = await deleteProductionJob(body.jobId);
        break;
      case "renameCrew":
        if (!body.oldName?.trim() || !body.newName?.trim()) {
          return NextResponse.json({ error: "renameCrew requires oldName and newName" }, { status: 400 });
        }
        result = await renameCrew(body.oldName, body.newName);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    revalidatePath("/production", "page");
    return NextResponse.json({ ok: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    console.error("Production action error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
