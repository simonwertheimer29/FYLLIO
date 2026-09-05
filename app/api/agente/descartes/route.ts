// app/api/agente/descartes/route.ts
//
// GET /api/agente/descartes?dias=30 — los DESCARTES DEL REVISOR por clínica y
// motivo (auditoría 2026-09-05, MEJORAS 151). El motivo lleva persistido en
// `evaluacion_json.borradorDescartado.motivo` desde el 14-08 y nadie lo
// agregaba: es el único número que dice si el generador se está degradando
// o si una clínica tiene la configuración mal (sube «economica» → publicó
// algo que el juez no ve; sube «agenda» → el prompt derivó).
//
// Aislamiento (§5): admin ve la red; otro rol solo sus clínicas; los hilos
// sin clínica solo los ve la red.

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { requireCliente } from "../../../lib/cliente-contexto";

export const dynamic = "force-dynamic";

export type DescartesClinica = {
  clinicaId: string | null;
  clinicaNombre: string | null;
  turnos: number;
  descartes: number;
  porMotivo: Record<string, number>;
};

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? 30);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(Math.round(diasRaw), 1), 365) : 30;
  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    const filas = await runWithCliente(session.cliente, async () => {
      const cliente = requireCliente("agente/descartes");
      return runWithClienteDb(cliente, async (trx) => {
        const r = await sql<{ clinica_id: string | null; clinica_nombre: string | null; motivo: string; n: number }>`
          with ev as (
            select e.caso_id,
                   (e.evaluacion_json::jsonb -> 'borradorDescartado' ->> 'motivo') as motivo
              from eventos_automatizacion e
             where e.tipo_caso = 'conversacion' and e.evento = 'evaluacion'
               and e.created_at > now() - make_interval(days => ${dias})
               and e.evaluacion_json is not null
               and e.evaluacion_json ~ '^\\s*\\{'
          ),
          cl as (
            select telefono,
                   (array_agg(clinica_id order by "timestamp" desc)
                      filter (where clinica_id is not null))[1] as clinica_id
              from mensajes_whatsapp
             where telefono is not null and "timestamp" is not null
             group by telefono
          )
          select cl.clinica_id, c.nombre as clinica_nombre, coalesce(ev.motivo, '') as motivo, count(*)::int as n
            from ev
            left join cl on cl.telefono = ev.caso_id
            left join clinicas c on c.cliente = ${cliente} and c.id = cl.clinica_id
           group by 1, 2, 3
           order by 2 nulls last, 3`.execute(trx);
        return r.rows;
      });
    });

    const porClinica = new Map<string, DescartesClinica>();
    for (const f of filas) {
      const id = f.clinica_id ? String(f.clinica_id) : null;
      if (clinicasPermitidas && (id == null || !clinicasPermitidas.includes(id))) continue;
      const k = id ?? "";
      const d = porClinica.get(k) ?? { clinicaId: id, clinicaNombre: f.clinica_nombre ?? null, turnos: 0, descartes: 0, porMotivo: {} };
      d.turnos += Number(f.n) || 0;
      if (f.motivo) {
        d.descartes += Number(f.n) || 0;
        d.porMotivo[f.motivo] = (d.porMotivo[f.motivo] ?? 0) + (Number(f.n) || 0);
      }
      porClinica.set(k, d);
    }
    const lista = [...porClinica.values()].sort((a, b) => b.descartes - a.descartes || b.turnos - a.turnos);
    return NextResponse.json({ dias, clinicas: lista });
  } catch (err) {
    console.error("[agente/descartes]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudieron leer los descartes" }, { status: 500 });
  }
});
