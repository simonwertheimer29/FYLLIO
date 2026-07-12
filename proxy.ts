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
    const { payload } = await jwtVerify(token, s);
    // Un token con `purpose` (identificación efímera) no es una sesión, aunque
    // comparta secreto de firma. No debe abrir rutas protegidas.
    if ("purpose" in payload) return false;
    return true;
  } catch {
    return false;
  }
}

// Sprint A / P0.3 — Superficie demo/dev que leía y ESCRIBÍA en el Airtable de
// producción sin autenticación. No la usa el producto vivo (Leads/Presupuestos/
// Pacientes/Copilot/no-shows): solo los componentes del cluster demo/agenda-MVP.
// En producción devolvemos 404 (que no existan); en local/dev siguen abiertas.
// Método reversible (no se borra nada). El webhook de Twilio NO está aquí: es
// entrada externa real y se protege con firma en su handler, no se cierra.
const BLOCKED_IN_PROD_PREFIXES = [
  "/api/db",
  "/api/dashboard",
  "/api/scheduler",
  "/api/whatsapp/send",
  "/api/ai-suggestions",
  "/api/dev", // incluye /api/dev/whatsapp-sim
  "/api/import/gesden", // importador demo (escribe en Airtable de producción)
  "/api/no-shows/dev", // seed / purge / audit / campos — solo desarrollo
  "/api/twilio/whatsapp", // chatbot de la primera demo; código (con firma) se conserva como referencia
];

function isBlockedInProd(path: string): boolean {
  return BLOCKED_IN_PROD_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1) Cierre de superficie demo/dev en producción.
  if (isBlockedInProd(path)) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  // 2) Auth de las rutas protegidas (matcher Sprint 7/8).
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = token ? await hasValidSession(token) : false;
  if (ok) return NextResponse.next();

  const isApi = path.startsWith("/api/");
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
    // Sprint 8 — módulos nuevos
    "/leads/:path*",
    "/pacientes/:path*",
    "/actuar-hoy/:path*",
    "/red/:path*",
    "/alertas/:path*",
    "/kpis/:path*",
    "/automatizaciones/:path*",
    "/api/leads/:path*",
    "/api/pacientes/:path*",
    "/api/alertas/:path*",
    // Sprint A — superficie demo/dev cerrada en producción (P0.3).
    "/api/db/:path*",
    "/api/dashboard/:path*",
    "/api/scheduler/:path*",
    "/api/whatsapp/send",
    "/api/ai-suggestions",
    "/api/dev/:path*",
    "/api/import/gesden",
    "/api/no-shows/dev/:path*",
    "/api/twilio/whatsapp",
  ],
};
