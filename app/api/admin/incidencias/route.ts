// app/api/admin/incidencias/route.ts
//
// GET /api/admin/incidencias?horas=24|168 — las incidencias del cliente de la
// sesión, agrupadas por (clínica, tipo, motivo), para Ajustes › Incidencias
// (MEJORAS 207). Solo admin. Un fallo de carga es un 500 real (§10), nunca una
// lista vacía.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { listarIncidencias, plazoRetencionIncidencias, UMBRAL_SISTEMATICO } from "../../../lib/incidencias";
import { estadoCola } from "../../../lib/cola/qstash";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  const horasRaw = Number(new URL(req.url).searchParams.get("horas") ?? 24);
  const horas = horasRaw === 168 ? 168 : 24;
  try {
    const grupos = await runWithCliente(session.cliente, () => listarIncidencias({ horas }));
    const cola = estadoCola();
    return NextResponse.json({
      grupos,
      horas,
      plazoDias: plazoRetencionIncidencias(),
      umbral: UMBRAL_SISTEMATICO,
      cola: cola.activa ? { activa: true } : { activa: false, motivo: cola.motivo },
      generadoEn: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[admin/incidencias]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudieron cargar las incidencias" }, { status: 500 });
  }
});
