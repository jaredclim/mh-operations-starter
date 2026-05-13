import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "mh_dash_session";
const SESSION_DAYS = 30;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET env var not set");
  return new TextEncoder().encode(secret);
}

export function getDashboardPassword(): string {
  const pw = process.env.DASHBOARD_PASSWORD?.trim();
  if (!pw) throw new Error("DASHBOARD_PASSWORD env var not set");
  return pw;
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  return await new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_COOKIE_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
