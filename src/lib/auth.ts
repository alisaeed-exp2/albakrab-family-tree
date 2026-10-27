import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "bk_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function checkPassword(input: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(input).digest("hex");
  const b = crypto.createHash("sha256").update(expected).digest("hex");
  return safeEqual(a, b);
}

export async function startAdminSession() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const token = `${exp}.${sign(String(exp))}`;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endAdminSession() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  try {
    return safeEqual(sig, sign(exp));
  } catch {
    return false;
  }
}
