import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  appendNote,
  archiveLead,
  changeStage,
  logTouch,
  revertTouch,
  setPromise,
  snoozeFollowUp,
  updateEstValue,
  updateOppTodoList,
} from "@/lib/leadActions";

type ActionBody =
  | { action: "touch"; leadId: string; type: "Call" | "VM" | "Email" | "Text" | "Estimate" | "Note" }
  | { action: "snooze"; leadId: string; days?: number; date?: string; fuType?: "Call" | "Email" | "Text" }
  | { action: "note"; leadId: string; text: string }
  | { action: "stage"; leadId: string; newStage: "Proposal Sent" | "Verbal Yes" | "On Hold" | "Long-Term" }
  | { action: "promise"; leadId: string; promise: boolean; time?: string }
  | { action: "value"; leadId: string; value: number }
  | { action: "archive"; leadId: string; result: "Won" | "Lost"; bookedValue?: number; reasonLost?: string; note?: string }
  | {
      action: "revert";
      leadId: string;
      snapshot: {
        lastTouchDate?: string;
        lastTouchType?: string;
        nextFollowUpDate?: string;
        callAttempts?: number;
        notes?: string;
      };
    }
  | { action: "todo"; leadId: string; items: { id: string; text: string; done: boolean }[] };

export async function POST(req: NextRequest) {
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("action" in body) || !("leadId" in body)) {
    return NextResponse.json({ error: "Missing action or leadId" }, { status: 400 });
  }

  try {
    let result: unknown;
    switch (body.action) {
      case "touch":
        result = await logTouch(body.leadId, body.type);
        break;
      case "snooze":
        if (body.days != null) {
          result = await snoozeFollowUp(body.leadId, body.days, body.fuType);
        } else if (body.date) {
          result = await snoozeFollowUp(body.leadId, body.date, body.fuType);
        } else {
          return NextResponse.json({ error: "snooze requires days or date" }, { status: 400 });
        }
        break;
      case "note":
        if (!body.text?.trim()) return NextResponse.json({ error: "note requires text" }, { status: 400 });
        result = await appendNote(body.leadId, body.text);
        break;
      case "stage":
        result = await changeStage(body.leadId, body.newStage);
        break;
      case "promise":
        result = await setPromise(body.leadId, body.promise, body.time);
        break;
      case "value":
        if (typeof body.value !== "number" || isNaN(body.value)) {
          return NextResponse.json({ error: "value must be a number" }, { status: 400 });
        }
        result = await updateEstValue(body.leadId, body.value);
        break;
      case "archive":
        if (body.result !== "Won" && body.result !== "Lost") {
          return NextResponse.json({ error: "archive requires result Won or Lost" }, { status: 400 });
        }
        result = await archiveLead(body.leadId, body.result, {
          bookedValue: body.bookedValue,
          reasonLost: body.reasonLost,
          note: body.note,
        });
        break;
      case "revert":
        if (!body.snapshot || typeof body.snapshot !== "object") {
          return NextResponse.json({ error: "revert requires snapshot" }, { status: 400 });
        }
        result = await revertTouch(body.leadId, body.snapshot);
        break;
      case "todo":
        if (!Array.isArray(body.items)) {
          return NextResponse.json({ error: "todo requires items array" }, { status: 400 });
        }
        result = await updateOppTodoList(body.leadId, body.items);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Bust caches for every surface that reads Opportunities data — so
    // touching in Focus Mode immediately reflects on Pipeline / Leads /
    // Production tabs (and vice versa).
    revalidatePath("/", "page");
    revalidatePath("/focus", "page");
    revalidatePath("/leads", "page");
    revalidatePath("/production", "page");

    return NextResponse.json({ ok: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    console.error("Lead action error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
