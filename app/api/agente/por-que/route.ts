// app/api/agente/por-que/route.ts
//
// GET /api/agente/por-que?telefono=…            → los turnos explicados del hilo (2.8, MEJORAS 183)
// GET /api/agente/por-que?telefono=…&replay=<id> → la sesión del banco para reproducir ese turno
//
// Aislamiento (§5): EXACTAMENTE el de la ficha (/api/agente/ficha) — las
// clínicas visibles salen de la sesión; admin ve la red, cualquier otro rol
// solo sus clínicas, fail-closed, y fuera de scope → 404 (nunca un «por qué»
// ajeno). Un fallo es un 500 real (§10), jamás una lista vacía que se lea
// como «el agente no decidió nada aquí».

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { puedeVerHiloSesion } from "../../../lib/agente/acceso-hilo-sesion";
import { porQueDeHilo, replayDeHilo } from "../../../lib/agente/por-que";
import { anotarCorrecciones } from "../../../lib/agente/candidatos-eval";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const telefono = (url.searchParams.get("telefono") ?? "").trim();
  const replay = (url.searchParams.get("replay") ?? "").trim();
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      // La regla del HILO (MEJORAS 122), la misma que la ficha y los candidatos.
      if (!(await puedeVerHiloSesion(session, telefono))) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      if (replay) {
        const r = await replayDeHilo(telefono, replay);
        if (!r) return NextResponse.json({ error: "Ese mensaje no está en la conversación" }, { status: 404 });
        return NextResponse.json(r);
      }
      // 2.7: cada turno lleva su corrección si una persona lo marcó como error.
      const turnos = await anotarCorrecciones(telefono, await porQueDeHilo(telefono));
      return NextResponse.json({ turnos });
    });
  } catch (err) {
    console.error("[agente/por-que]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer por qué decidió el agente" }, { status: 500 });
  }
});
