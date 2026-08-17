// app/api/agente/casos/route.ts
//
// GET /api/agente/casos — LA COLA DE CASOS DEL AGENTE (fase B, B2): los
// hilos con asunto ENTREGADO y sin resolver, una línea por caso (paciente ·
// qué quiere · cuánto lleva esperando), los más viejos primero. Es la lista
// de presión que sustituye a la caducidad (decisión del 17-08): nada expira
// solo, pero envejece a la vista.
//
// Fuente: el censo del semáforo (derivados sin resolver) + la línea de la
// ficha — la MISMA `fichaDeCaso` que pinta el detalle: una fuente, dos
// densidades. Aislamiento: el criterio de la bandeja (sesión manda,
// fail-closed; hilos sin clínica solo rol de red).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { censoSemaforo } from "../../../lib/automatizacion/semaforo";
import { fichaDeCaso } from "../../../lib/agente/ficha-caso";

export const dynamic = "force-dynamic";

export type CasoDelAgente = {
  telefono: string;
  paciente: string;
  queQuiere: string;
  esperandoDesde: string | null;
  edadDias: number;
  enEspera: boolean;
};

export const GET = withAuth(async (session) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      const censo = await censoSemaforo();
      const entregados = censo.filas.filter((f) => f.motivo === "derivado_sin_resolver");
      const casos: CasoDelAgente[] = [];
      for (const f of entregados) {
        const ficha = await fichaDeCaso(f.telefono);
        if (clinicasPermitidas) {
          if (ficha.clinicaId == null || !clinicasPermitidas.includes(String(ficha.clinicaId))) continue;
        }
        casos.push({
          telefono: f.telefono,
          paciente: ficha.linea.paciente,
          queQuiere: ficha.linea.queQuiere,
          esperandoDesde: ficha.linea.esperandoDesde,
          edadDias: f.edadDias,
          enEspera: ficha.espera != null,
        });
      }
      // Los más viejos primero: la edad ES la presión.
      casos.sort((a, b) => b.edadDias - a.edadDias);
      return NextResponse.json({ casos });
    });
  } catch (err) {
    // §10: fallo = 500 real, jamás una cola vacía que se lea como «no hay
    // casos» — para la coordinadora son indistinguibles y deja de mirar.
    console.error("[agente/casos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo cargar la cola del agente" }, { status: 500 });
  }
});
