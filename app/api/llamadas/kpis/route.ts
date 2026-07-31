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
import { hoyISO, inicioDelDiaUTC } from "../../../lib/time";

export const dynamic = "force-dynamic";

const TOPE = 200;

export const GET = withAuth(async () => {
  // Día y mes de la CLÍNICA. `setHours(0,0,0,0)` y `new Date(y, m, 1)` son los
  // del PROCESO, y en Vercel el proceso corre en UTC: "llamadas hoy" empezaba a
  // las 02:00 de Madrid y se comía las dos primeras horas del día. Es la misma
  // familia de MEJORAS 52 que ya se cerró en /cobros y en /kpis.
  const hoy = hoyISO();
  const inicioHoy = inicioDelDiaUTC(hoy);
  const inicioMes = inicioDelDiaUTC(`${hoy.slice(0, 7)}-01`);

  // Trae las del mes y filtra en JS — más simple y económico que
  // 4 queries separadas para volúmenes pequeños esperados.
  const llamadasMes = await listLlamadas({
    desde: inicioMes.toISOString(),
    limit: TOPE,
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
    // Un tope que no se declara convierte "el coste del mes" en "el coste de
    // las 200 primeras" sin que nadie se entere (familia de MEJORAS 65). Con
    // 12 llamadas no muerde; con volumen, mentiría.
    topeAlcanzado: llamadasMes.length >= TOPE,
  });
});
