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
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { contextoDeConversacion } from "../../../lib/agente/contexto-conversacion";
import { clinicasDelHilo, puedeVerHilo } from "../../../lib/mensajeria/acceso-hilo";
import { porQueDeHilo, replayDeHilo } from "../../../lib/agente/por-que";

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

  const clinicasPermitidas = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      if (clinicasPermitidas) {
        // La regla del HILO (MEJORAS 122): cualquiera de sus clínicas; sin
        // clínica, la de la ficha desempata; sin ninguna, solo la red.
        const ctx = await contextoDeConversacion(telefono);
        const { todas } = await clinicasDelHilo(telefono);
        const cls = todas.length ? todas : ctx.clinicaId ? [String(ctx.clinicaId)] : [];
        if (!puedeVerHilo(clinicasPermitidas, cls)) {
          return NextResponse.json({ error: "No encontrado" }, { status: 404 });
        }
      }
      if (replay) {
        const r = await replayDeHilo(telefono, replay);
        if (!r) return NextResponse.json({ error: "Ese mensaje no está en la conversación" }, { status: 404 });
        return NextResponse.json(r);
      }
      const turnos = await porQueDeHilo(telefono);
      return NextResponse.json({ turnos });
    });
  } catch (err) {
    console.error("[agente/por-que]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer por qué decidió el agente" }, { status: 500 });
  }
});
