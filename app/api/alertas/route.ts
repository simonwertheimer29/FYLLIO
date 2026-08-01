// app/api/alertas/route.ts
// Sprint 8 D.7 — GET agregado de situaciones por clínica y tipo.
//
// Pasada de /alertas (2026-08-01). Tres cosas cambian aquí:
//
//  1 · Los cooldowns salen de UNA lectura, no de ocho. El bucle anterior
//      llamaba a `lastAlertFor` por (clínica × tipo) EN SERIE, y cada llamada
//      lee la tabla entera y filtra en memoria: ocho lecturas completas para
//      pintar ocho líneas. Medido: 7,2 s de los 13,7 s totales en local.
//  2 · Se calculan para los OCHO tipos, no para cinco. Los tres de cobros se
//      quedaban fuera de la lista, así que su botón nunca se veía "Enviada" y
//      el servidor respondía 429 a quien lo pulsaba: la UI ofrecía una acción
//      que iba a fallar.
//  3 · Viaja la foto del envío (`nAlEnviar`) para que la pantalla pueda
//      responder si el aviso sirvió, y las posposiciones vivas.

import { NextResponse } from "next/server";
import { withAdmin } from "../../lib/auth/session";
import { calcularAlertas } from "../../lib/alertas/calcular";
import {
  ultimasAlertasPorClinicaTipo,
  COOLDOWN_ALERTA_MS,
} from "../../lib/alertas/historial";
import { pospuestasVivas } from "../../lib/alertas/pospuestas";
import { TIPOS_ALERTA } from "../../lib/alertas/templates";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  const [alertas, ultimas, pospuestas] = await Promise.all([
    calcularAlertas(),
    ultimasAlertasPorClinicaTipo(),
    pospuestasVivas(),
  ]);

  const now = Date.now();
  const enriched = alertas.map((a) => {
    const cooldowns: Record<string, { untilMs: number } | null> = {};
    /** Qué pasó con el último aviso de este tipo: contra cuántos casos se
     *  envió, a quién, y cuántos hay AHORA. Es lo que convierte la pantalla en
     *  supervisión en vez de en un botón de avisar. */
    const ultimoAviso: Record<
      string,
      { enviadaEn: string; a: string | null; nEntonces: number | null; nAhora: number } | null
    > = {};
    const pospuesta: Record<string, { ocultaHasta: string; por: string | null } | null> = {};

    for (const t of TIPOS_ALERTA) {
      const p = pospuestas.get(`${a.clinicaId}:${t}`);
      pospuesta[t] = p ? { ocultaHasta: p.ocultaHasta, por: p.pospuestaPorNombre } : null;

      if (a.counts[t] <= 0) continue;
      const last = ultimas.get(`${a.clinicaId}:${t}`) ?? null;
      if (!last) {
        cooldowns[t] = null;
        ultimoAviso[t] = null;
        continue;
      }
      const enviadaMs = new Date(last.createdAt).getTime();
      cooldowns[t] =
        now - enviadaMs < COOLDOWN_ALERTA_MS
          ? { untilMs: enviadaMs + COOLDOWN_ALERTA_MS }
          : null;
      ultimoAviso[t] = {
        enviadaEn: last.createdAt,
        a: last.coordinadoraNombre,
        nEntonces: last.nAlEnviar,
        nAhora: a.counts[t],
      };
    }

    return { ...a, cooldowns, ultimoAviso, pospuesta };
  });

  return NextResponse.json({ alertas: enriched });
});
