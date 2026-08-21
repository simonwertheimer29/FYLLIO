// app/api/seguimiento/cola/route.ts
//
// GET — LA COLA DE SEGUIMIENTO por cohortes (P2, 18-08): los casos que
// exigen una persona, clasificados en las TRES (lib/seguimiento/cola). El
// cliente no recalcula criterio: recibe cohorte, detalle y edades resueltas.
//
// Aislamiento: los datos de negocio guardan la clínica por ID de NEGOCIO;
// la sesión trae IDs CENTRALES. Se scopea con clinicasNegocioAccesibles y
// se REMAPEA cada caso al espacio central (id + nombre) para que el filtro
// de clínica del UI (ClinicContext) case — el mismo puente que usa la page
// de Seguimiento desde el Sprint B. Fail-closed: caso sin clínica resoluble
// solo para rol de red.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { clinicasNegocioAccesibles } from "../../../lib/clinicas-negocio";
import { colaDeSeguimiento, type CasoDeCola } from "../../../lib/seguimiento/cola";

export const dynamic = "force-dynamic";

export type CasoDeColaUI = Omit<CasoDeCola, "clinicaId"> & {
  /** ID CENTRAL de la clínica (el espacio del selector del UI). */
  clinicaId: string | null;
  clinicaNombre: string | null;
};

export const GET = withAuth(async (session) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      const scope = await clinicasNegocioAccesibles({
        userId: session.userId,
        rol: session.rol,
        cliente: session.cliente!,
      });
      const { casos } = await colaDeSeguimiento();
      const visibles = casos.filter((c) =>
        scope.ids === null ? true : c.clinicaId != null && scope.ids.includes(c.clinicaId),
      );
      const casosUI: CasoDeColaUI[] = visibles.map((c) => {
        const nombre = c.clinicaId ? scope.nombreById.get(c.clinicaId) ?? null : null;
        return {
          ...c,
          clinicaId: nombre ? scope.centralIdByNombre.get(nombre) ?? null : null,
          clinicaNombre: nombre,
        };
      });
      return NextResponse.json({ casos: casosUI });
    });
  } catch (err) {
    console.error("[seguimiento/cola] error:", err);
    return NextResponse.json({ error: "No se pudo cargar la cola" }, { status: 500 });
  }
});
