// app/api/auth/logout/route.ts
// Logout unificado Sprint 7: limpia la cookie global `fyllio_session` y también
// las cookies legacy (`fyllio_presupuestos_token`, `fyllio_noshows_token`) para
// que "Salir" desde cualquier shell siempre deje al usuario deslogueado en
// TODOS los sistemas y caiga en /login nuevo.

import { NextResponse } from "next/server";
import { clearSessionCookie } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

const LEGACY_COOKIES = ["fyllio_presupuestos_token", "fyllio_noshows_token"];

export async function POST() {
  const res = NextResponse.json({ ok: true, redirect: "/login" });
  clearSessionCookie(res);
  for (const name of LEGACY_COOKIES) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}
