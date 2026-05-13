import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST() {
  // Bust ISR cache for the dashboard root so the next render fetches fresh sheet data
  revalidatePath("/", "page");
  return NextResponse.json({
    ok: true,
    revalidatedAt: new Date().toISOString(),
  });
}
