// app/api/admin/reconciliar-pagos/route.ts
//
// Sprint 14a Bloque 6 — endpoint admin que recalcula
// Pacientes.Pagado/Pendiente para todos los pacientes con
// Inconsistencias_Pagos sin resolver. Marca las inconsistencias
// procesadas como Resuelto=true.
//
// Uso tipico:
//   - POST sin body: procesa todas las inconsistencias pendientes.
//   - POST { pacienteIds: ["recX", "recY"] }: reconciliacion manual
//     puntual sin tocar el log de inconsistencias (no marca
//     Resuelto, util para recalcular un paciente concreto sin
//     ensuciar la tabla).
//
// Reutilizable como cron mensual (ver vercel.json) si se quiere
// barrido preventivo.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { reconciliarPagosCache } from "../../../lib/pagos";

export const dynamic = "force-dynamic";

export const POST = withAdmin(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as
    | { pacienteIds?: string[] }
    | null;
  const result = await reconciliarPagosCache({
    pacienteIds: body?.pacienteIds,
  });
  return NextResponse.json(result);
});
