// app/api/seguimiento/resumen/route.ts
//
// GET — la CABECERA de Seguimiento (delta P1, 18-08): dinero parado en la
// cola, desglose por cohorte, leads contados y la antigüedad del caso más
// viejo. Sustituye al «13% del plan de hoy» — una métrica inventada: nadie
// fijó un plan. Aquí solo HECHOS de la cola de tres cohortes.
//
// Aislamiento: sesión manda, fail-closed. Casos sin clínica resoluble solo
// para rol de red (admin) — mismo criterio que la bandeja.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { clinicasNegocioAccesibles } from "../../../lib/clinicas-negocio";
import { colaDeSeguimiento, ORDEN_COHORTES, type Cohorte } from "../../../lib/seguimiento/cola";

export const dynamic = "force-dynamic";

export type ResumenSeguimiento = {
  dineroParado: number;
  /** F5 — segundo bolsillo: cobros vencidos EN LA COLA. No se suma al
   *  dineroParado (dictado): presupuestos por cerrar y deudas vencidas no
   *  son el mismo dinero. */
  dineroCobros: number;
  leadsSinImporte: number;
  masViejoDias: number | null;
  porCohorte: Record<Cohorte, number>;
  totalCasos: number;
};

export const GET = withAuth(async (session) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      // Los casos llevan IDs de clínica de NEGOCIO; la sesión trae CENTRALES.
      // El scope correcto es el puente del Sprint B — con listClinicaIdsForUser
      // una coordinadora vería cifras a CERO (los espacios no casan).
      const scope = await clinicasNegocioAccesibles({
        userId: session.userId,
        rol: session.rol,
        cliente: session.cliente!,
      });
      const { casos } = await colaDeSeguimiento();
      // El resumen se calcula DESPUÉS de recortar al scope: el dinero que ve
      // una coordinadora es el de sus clínicas, no el de la red.
      const visibles = scope.ids === null
        ? casos
        : casos.filter((c) => c.clinicaId != null && scope.ids!.includes(c.clinicaId));
      const porCohorte = Object.fromEntries(ORDEN_COHORTES.map((c) => [c, 0])) as Record<Cohorte, number>;
      for (const c of visibles) porCohorte[c.cohorte]++;
      const resumen: ResumenSeguimiento = {
        dineroParado: visibles
          .filter((c) => c.tipo === "presupuesto" && c.importe != null)
          .reduce((s, c) => s + (c.importe ?? 0), 0),
        dineroCobros: visibles.reduce((s, c) => s + (c.cobro?.pendiente ?? 0), 0),
        leadsSinImporte: visibles.filter((c) => c.tipo === "lead").length,
        masViejoDias: visibles.length ? Math.max(...visibles.map((c) => c.paradoDias)) : null,
        porCohorte,
        totalCasos: visibles.length,
      };
      return NextResponse.json(resumen);
    });
  } catch (err) {
    console.error("[seguimiento/resumen] error:", err);
    return NextResponse.json({ error: "No se pudo calcular el resumen" }, { status: 500 });
  }
});
