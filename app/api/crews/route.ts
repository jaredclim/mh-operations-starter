import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchCrewData, writeCrewData } from "@/lib/sheets";

export async function GET() {
  try {
    const data = await fetchCrewData();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

interface PutBody {
  manualCrews?: string[];
  blocks?: Record<string, string>;
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as PutBody;
    const current = await fetchCrewData();
    const merged = {
      manualCrews: Array.isArray(body.manualCrews) ? body.manualCrews : current.manualCrews,
      blocks: body.blocks && typeof body.blocks === "object" ? body.blocks : current.blocks,
    };
    await writeCrewData(merged);
    revalidatePath("/production", "page");
    return NextResponse.json({ ok: true, ...merged });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
