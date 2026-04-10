// app/api/no-shows/auth/logout/route.ts
import { NextResponse } from "next/server";

const COOKIE = "fyllio_noshows_token";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
