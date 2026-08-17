// app/api/agente/ficha/route.ts
//
// GET /api/agente/ficha?telefono=… — LA ficha del caso (fase B, B1). Una
// sola fuente (lib/agente/ficha-caso); Seguimiento y Mensajería pintan lo
// mismo porque leen lo mismo.
//
// Aislamiento (§5): el MISMO criterio que la bandeja de mensajería — las
// clínicas visibles salen de la sesión, nunca de un parámetro; admin ve la
// red (incluidos hilos sin clínica), cualquier otro rol SOLO sus clínicas y
// fail-closed. Fuera de scope → 404, nunca una ficha ajena.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { fichaDeCaso } from "../../../lib/agente/ficha-caso";
import { contextoDeConversacion } from "../../../lib/agente/contexto-conversacion";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const telefono = (url.searchParams.get("telefono") ?? "").trim();
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  }

  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      const ctx = await contextoDeConversacion(telefono);
      if (clinicasPermitidas) {
        // Hilo sin clínica = solo rol de red (decisión del 2026-08-11).
        if (ctx.clinicaId == null || !clinicasPermitidas.includes(String(ctx.clinicaId))) {
          return NextResponse.json({ error: "No encontrado" }, { status: 404 });
        }
      }
      const ficha = await fichaDeCaso(telefono);
      return NextResponse.json(ficha);
    });
  } catch (err) {
    // §10: un fallo es un 500 real — jamás una ficha vacía que se lea como
    // «no hay nada recogido».
    console.error("[agente/ficha]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo componer la ficha" }, { status: 500 });
  }
});
