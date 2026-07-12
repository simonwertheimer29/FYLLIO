// app/api/auth/admin-pin-login/route.ts
// Sprint 7 v5 — login admin por PIN 6 dígitos. Sin 2FA.
// Rate limit 5/15min por `admin:ip`.

import { NextResponse } from "next/server";
import { listAdminCandidates } from "../../../lib/auth/users";
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
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 401 });
    }

    const ip = extractIp(req);
    // Limiter persistente (KV) compartido entre lambdas; fail-closed en prod.
    const limitKeys = [`admin:ip:${ip}`];
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

    // Candidatos = admins activos con Pin_hash. Normalmente 1; soportamos N
    // por si hay varios admins en el futuro (Fase 6 permite crear más).
    const candidates = await listAdminCandidates();
    let matched: (typeof candidates)[number] | null = null;
    for (const u of candidates) {
      if (u.pinLength !== 6) continue;
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

    // Sprint B — el admin pertenece a un cliente (Usuarios.Cliente) y su acceso
    // "*" abarca las clínicas de ESE cliente. Sin cliente, fail-closed.
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
        rol: "admin",
        cliente: matched.cliente,
        clinicasAccesibles: ["*"],
        nombre: matched.nombre,
      },
      "24h"
    );

    const res = NextResponse.json({
      ok: true,
      user: { id: matched.id, nombre: matched.nombre, rol: "admin" },
      // Sprint 8: admin aterriza en /red.
      redirect: "/red",
    });
    setSessionCookie(res, token);
    // Emite cookies legacy para que los endpoints de Sprints 1-5
    // (/api/presupuestos/*, /api/no-shows/*, etc.) sigan autenticando
    // al usuario sin reescribir su lógica. Unificación en Sprint 8.
    const sessionForLegacy = await verifySession(token);
    if (sessionForLegacy) await emitLegacyCookies(res, sessionForLegacy);
    return res;
  } catch (err) {
    // Sprint 14b hotfix — logueamos el error real para diagnostico.
    // Antes solo devolviamos 500 silencioso, lo que oculto un crash
    // de routing al introducir slug names duplicados en otro endpoint
    // (afecto a TODA la app, incluyendo este handler). El catch
    // original quedaba silencioso y el debug fue ciego.
    console.error(
      "[admin-pin-login] error:",
      err instanceof Error ? err.stack ?? err.message : err,
    );
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
