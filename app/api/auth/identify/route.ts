// app/api/auth/identify/route.ts
//
// Paso 1 del login email+PIN (rediseño jul 2026): identifica al USUARIO.
//  - Rate limit persistente (KV) por email Y por IP — fail-closed en prod.
//  - Error genérico único: no revela si el email existe (anti-enumeración).
//  - Con 1 clínica (coord) o ≤1 (admin) emite la sesión directamente;
//    con varias devuelve un token efímero + SOLO sus clínicas para elegir.
// La sesión emitida es idéntica a la de pin-login (aislamiento intacto).

import { NextResponse } from "next/server";
import { verifyPin } from "../../../lib/auth/hashing";
import { signIdentToken } from "../../../lib/auth/identToken";
import { buildLoginResponse } from "../../../lib/auth/loginSession";
import {
  checkLimitKv,
  extractIp,
  ipKey,
  recordFailureKv,
  recordSuccessKv,
  userKey,
} from "../../../lib/auth/pinRateLimitKv";
import {
  findUsersByEmail,
  isValidLoginEmail,
  listClinicaIdsForUser,
  listClinicas,
  normalizeEmail,
} from "../../../lib/auth/users";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "Email o PIN incorrectos.";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!isValidLoginEmail(email) || !/^\d{4}$|^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const ip = extractIp(req);
    const limitKeys = [userKey(email), ipKey(ip)];
    const gate = await checkLimitKv(limitKeys);
    if (!gate.allowed) {
      const mins = Math.max(1, Math.ceil(gate.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error: `Demasiados intentos. Vuelve a intentarlo en ${mins} min.`,
          retryAfterSeconds: gate.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
      );
    }

    // Email no es único: se compara el PIN contra todos los candidatos
    // activos (mismo patrón que el login de coordinación por clínica).
    const candidates = await findUsersByEmail(email);
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
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    // Sprint B — fail-closed: sin cliente no hay base de negocio.
    if (!matched.cliente) {
      return NextResponse.json(
        { error: "Tu usuario no está completamente configurado. Contacta con Fyllio." },
        { status: 403 },
      );
    }
    const cliente = matched.cliente;

    await recordSuccessKv(limitKeys);

    if (matched.rol === "admin") {
      // El admin siempre tiene sesión ["*"]; elegir clínica solo preselecciona
      // el selector. Con 0-1 clínicas no hay nada que elegir: entra directo.
      const clinicas = await listClinicas({ onlyActivas: true, cliente });
      if (clinicas.length <= 1) {
        return buildLoginResponse({ ...matched, cliente }, ["*"], {
          redirect: "/red",
          selectedClinicaId: "__all__",
        });
      }
      return NextResponse.json({
        ok: true,
        step: "clinica",
        identToken: await signIdentToken(matched.id),
        user: { nombre: matched.nombre, rol: matched.rol, pinLength: matched.pinLength },
        clinicas: clinicas.map((c) => ({ id: c.id, nombre: c.nombre })),
        allowAll: true,
      });
    }

    // Coordinación: solo SUS clínicas (junction), activas y de su cliente.
    const suyas = new Set(await listClinicaIdsForUser(matched.id));
    const clinicas = (await listClinicas({ onlyActivas: true, cliente })).filter((c) =>
      suyas.has(c.id),
    );

    if (clinicas.length === 0) {
      return NextResponse.json(
        { error: "Tu usuario no tiene clínicas asignadas. Habla con tu administrador." },
        { status: 403 },
      );
    }

    if (clinicas.length === 1) {
      const unica = clinicas[0]!;
      return buildLoginResponse({ ...matched, cliente }, [unica.id], {
        redirect: "/actuar-hoy",
        selectedClinicaId: unica.id,
      });
    }

    return NextResponse.json({
      ok: true,
      step: "clinica",
      identToken: await signIdentToken(matched.id),
      user: { nombre: matched.nombre, rol: matched.rol, pinLength: matched.pinLength },
      clinicas: clinicas.map((c) => ({ id: c.id, nombre: c.nombre })),
      allowAll: false,
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
