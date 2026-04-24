// proxy.ts — Next 16 middleware (nueva convención).
//
// Sprint 7: protege las rutas globales nuevas. Matcher explícito y cerrado.
// NO envuelve /presupuestos ni /no-shows — coexisten con su JWT legacy
// (fyllio_presupuestos_token, fyllio_noshows_token) hasta Sprint 8.

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "fyllio_session";

function secret(): Uint8Array | null {
  const raw = process.env.AUTH_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

async function hasValidSession(token: string): Promise<boolean> {
  const s = secret();
  if (!s) return false;
  try {
    await jwtVerify(token, s);
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = token ? await hasValidSession(token) : false;
  if (ok) return NextResponse.next();

  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/ajustes/:path*",
    "/api/admin/:path*",
    "/api/auth/me",
    // Sprint 8 — módulos nuevos (autenticación por withAuth, no requieren admin)
    "/leads/:path*",
    "/pacientes/:path*",
    "/api/leads/:path*",
    "/api/pacientes/:path*",
  ],
};
