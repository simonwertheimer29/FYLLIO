// app/api/auth/pin-login/route.ts
// Login coordinación (PIN 4 dígitos por clínica). Error genérico.
// Rate limit best-effort por (clinicaId:ip): 5 intentos / 15 min → 429.

import { NextResponse } from "next/server";
import { findCoordinacionesByClinica } from "../../../lib/auth/users";
import { verifyPin } from "../../../lib/auth/hashing";
import { signSession, setSessionCookie, verifySession } from "../../../lib/auth/session";
import { emitLegacyCookies } from "../../../lib/auth/legacy-cookies";
import {
  checkLimitKv,
  extractIp,
  recordFailureKv,
  recordSuccessKv,
} from "../../../lib/auth/pinRateLimitKv";

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
    // Limiter persistente (KV) — misma semántica que el viejo Map en memoria
    // pero compartida entre lambdas, y fail-closed en producción.
    const limitKeys = [`coord:${clinicaId}:ip:${ip}`];
    const gate = await checkLimitKv(limitKeys);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos, espera 15 minutos" },
        {
          status: 429,
          headers: { "Retry-After": String(gate.retryAfterSeconds) },
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
      await recordFailureKv(limitKeys);
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
    }

    // Sprint B — el usuario debe tener cliente asignado (Usuarios.Cliente) para
    // resolver su base de negocio. Sin él, fail-closed.
    if (!matched.cliente) {
      return NextResponse.json(
        { error: "Usuario sin cliente asignado. Contacta con soporte." },
        { status: 403 },
      );
    }

    await recordSuccessKv(limitKeys);

    const token = await signSession(
      {
        userId: matched.id,
        rol: "coordinacion",
        cliente: matched.cliente,
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
