// app/api/auth/pin-login/route.ts
// Login coordinación (PIN 4 dígitos por clínica). Error genérico.
// Rate limit best-effort por (clinicaId:ip): 5 intentos / 15 min → 429.

import { NextResponse } from "next/server";
import { findCoordinacionesByClinica } from "../../../lib/auth/users";
import { verifyPin } from "../../../lib/auth/hashing";
import { signSession, setSessionCookie, verifySession } from "../../../lib/auth/session";
import { emitLegacyCookies } from "../../../lib/auth/legacy-cookies";
import {
  checkLimit,
  extractIp,
  recordFailure,
  recordSuccess,
} from "../../../lib/auth/pinRateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const clinicaId = typeof body?.clinicaId === "string" ? body.clinicaId.trim() : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!clinicaId || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
    }

    const ip = extractIp(req);
    const scope = `coord:${clinicaId}`;
    const gate = checkLimit(scope, ip);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos, espera 15 minutos" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) },
        }
      );
    }

    const candidates = await findCoordinacionesByClinica(clinicaId);
    let matched: (typeof candidates)[number] | null = null;
    for (const u of candidates) {
      if (!u.pinHash) continue;
      if (await verifyPin(pin, u.pinHash)) {
        matched = u;
        break;
      }
    }

    if (!matched) {
      recordFailure(scope, ip);
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
    }

    recordSuccess(scope, ip);

    const token = await signSession(
      {
        userId: matched.id,
        rol: "coordinacion",
        clinicasAccesibles: [clinicaId],
        nombre: matched.nombre,
      },
      "24h"
    );

    const res = NextResponse.json({
      ok: true,
      user: { id: matched.id, nombre: matched.nombre, rol: "coordinacion" },
    });
    setSessionCookie(res, token);
    // Emite cookies legacy (ver legacy-cookies.ts). Desaparece en Sprint 8.
    const sessionForLegacy = await verifySession(token);
    if (sessionForLegacy) await emitLegacyCookies(res, sessionForLegacy);
    return res;
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
