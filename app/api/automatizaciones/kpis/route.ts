// app/api/automatizaciones/kpis/route.ts
//
// Sprint 16b Bloque 3 — KPIs hero del panel /automatizaciones.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listReglas, listAcciones } from "../../../lib/automatizaciones/repo";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const [reglas, accionesUlt100] = await Promise.all([
    listReglas(),
    listAcciones({ limit: 200 }),
  ]);

  const ahora = Date.now();
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const inicio7d = new Date(ahora - 7 * 24 * 3600 * 1000);

  const reglasActivas = reglas.filter((r) => r.activa).length;
  let disparosHoy = 0;
  let disparos7d = 0;
  let errores7d = 0;

  for (const a of accionesUlt100) {
    const t = new Date(a.ejecutadaAt).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= inicioHoy.getTime() && a.resultado === "success") disparosHoy += 1;
    if (t >= inicio7d.getTime()) {
      if (a.resultado === "success") disparos7d += 1;
      if (a.resultado === "error") errores7d += 1;
    }
  }

  return NextResponse.json({
    reglasActivas,
    reglasTotales: reglas.length,
    disparosHoy,
    disparos7d,
    errores7d,
  });
});
