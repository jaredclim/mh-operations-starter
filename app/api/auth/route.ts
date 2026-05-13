import { NextResponse } from "next/server";
import {
  createSessionToken,
  getDashboardPassword,
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const submitted = (body.password || "").trim();
  if (!submitted) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }
  let expected: string;
  try {
    expected = getDashboardPassword();
  } catch {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (submitted !== expected) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
