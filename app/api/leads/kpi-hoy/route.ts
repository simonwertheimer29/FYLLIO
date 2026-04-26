// app/api/leads/kpi-hoy/route.ts
//
// Sprint 10 C — devuelve KPIs operativos del día para la sub-tab Leads:
//  - tiempoMedioMin: minutos promedio entre WhatsApp_Entrante y siguiente
//    WhatsApp_Saliente del mismo lead. null si no hay pares.
//
// Filtra por clínicas accesibles según la sesión (admin = todas).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import {
  listAccionesHoy,
  tiempoMedioRespuestaMin,
} from "../../../lib/leads/acciones";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const allowed =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const acciones = await listAccionesHoy({ clinicaIdsAllowed: allowed });
  const tiempoMedioMin = tiempoMedioRespuestaMin(acciones);
  return NextResponse.json({ tiempoMedioMin, totalAcciones: acciones.length });
});
