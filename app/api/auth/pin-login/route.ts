// app/api/auth/pin-login/route.ts
// Login coordinación (PIN 4 dígitos por clínica). Error genérico.
// Rate limiting se añade en Fase 2.5.

import { NextResponse } from "next/server";
import { findCoordinacionesByClinica } from "../../../lib/auth/users";
import { verifyPin } from "../../../lib/auth/hashing";
import { signSession, setSessionCookie } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const clinicaId = typeof body?.clinicaId === "string" ? body.clinicaId.trim() : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!clinicaId || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
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
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
    }

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
    return res;
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
