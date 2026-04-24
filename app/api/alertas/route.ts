// app/api/alertas/route.ts
// Sprint 8 D.7 — GET agregado de situaciones por clínica y tipo + cooldowns activos.

import { NextResponse } from "next/server";
import { withAdmin } from "../../lib/auth/session";
import { calcularAlertas } from "../../lib/alertas/calcular";
import { lastAlertFor } from "../../lib/alertas/historial";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 2 * 60 * 60 * 1000;

export const GET = withAdmin(async () => {
  const alertas = await calcularAlertas();

  // Para cada card con counts>0 calculamos cooldown de cada tipo.
  const now = Date.now();
  const enriched = await Promise.all(
    alertas.map(async (a) => {
      const tipos = (["leads", "presupuestos", "citados", "automatizaciones"] as const).filter(
        (t) => a.counts[t] > 0
      );
      const cooldowns: Record<string, { untilMs: number } | null> = {};
      for (const t of tipos) {
        const last = await lastAlertFor(a.clinicaId, t);
        if (!last) {
          cooldowns[t] = null;
        } else {
          const elapsed = now - new Date(last.createdAt).getTime();
          if (elapsed < COOLDOWN_MS) {
            cooldowns[t] = { untilMs: new Date(last.createdAt).getTime() + COOLDOWN_MS };
          } else {
            cooldowns[t] = null;
          }
        }
      }
      return { ...a, cooldowns };
    })
  );

  return NextResponse.json({ alertas: enriched });
});
