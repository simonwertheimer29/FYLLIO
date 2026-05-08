// app/api/llamadas/kpis/route.ts
//
// Sprint 17 Bloque 6 — KPIs hero del panel /llamadas:
//   - llamadasHoy   (todas las iniciadas hoy).
//   - confirmadasHoy (resultado=confirmada hoy).
//   - fallidasHoy   (estado=fallida hoy).
//   - costeMesUSD   (suma Coste_USD del mes en curso).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listLlamadas } from "../../../lib/llamadas/repo";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const inicioMes = new Date(inicioHoy.getFullYear(), inicioHoy.getMonth(), 1);

  // Trae las del mes y filtra en JS — más simple y económico que
  // 4 queries separadas para volúmenes pequeños esperados.
  const llamadasMes = await listLlamadas({
    desde: inicioMes.toISOString(),
    limit: 200,
  });

  let llamadasHoy = 0;
  let confirmadasHoy = 0;
  let fallidasHoy = 0;
  let costeMesUSD = 0;
  for (const l of llamadasMes) {
    const t = new Date(l.iniciadaAt).getTime();
    if (Number.isNaN(t)) continue;
    if (typeof l.costeUSD === "number") costeMesUSD += l.costeUSD;
    if (t >= inicioHoy.getTime()) {
      llamadasHoy += 1;
      if (l.resultado === "confirmada") confirmadasHoy += 1;
      if (l.estado === "fallida") fallidasHoy += 1;
    }
  }
  return NextResponse.json({
    llamadasHoy,
    confirmadasHoy,
    fallidasHoy,
    costeMesUSD: Math.round(costeMesUSD * 100) / 100,
  });
});
