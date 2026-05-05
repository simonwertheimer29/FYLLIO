// app/api/cron/automatizaciones-evaluar/route.ts
//
// Sprint 16b Bloque 4 — cron job que evalúa los triggers basados en
// tiempo cada 15 min. Vercel cron auth via header Authorization:
// Bearer <CRON_SECRET>. En dev local podemos ejecutar pasando el
// mismo header con `curl -H "Authorization: Bearer …"`.
//
// Triggers manejados aquí (event-based viven en código que llama
// emitirEvento):
//   - cita_confirmada_24h_antes
//   - presupuesto_estancado_7d
//   - lead_inactivo_n_dias
//   - lead_sin_gestionar_2h  (delay sobre lead_creado, evaluado aquí
//     porque el evento ocurrió en el pasado)
//
// Returna {evaluados, ejecutados, errores, detalle: {triggerN: ...}}

import { NextResponse } from "next/server";
import { fetchAll, base, TABLES } from "../../../lib/airtable";
import {
  evaluarRegla,
  evaluarReglasParaEvento,
} from "../../../lib/automatizaciones/engine";
import { listReglasActivasParaTrigger } from "../../../lib/automatizaciones/repo";
import type { EventoSistema } from "../../../lib/automatizaciones/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  // Vercel cron envía Authorization: Bearer <CRON_SECRET>.
  const expected = process.env["CRON_SECRET"];
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) return unauthorized();
  }

  const start = Date.now();
  const detalle: Record<string, { evaluados: number; matches: number }> = {};

  // 1. cita_confirmada_24h_antes
  detalle.cita_24h = await evaluarTriggerCita24h();

  // 2. presupuesto_estancado_7d
  detalle.presupuesto_7d = await evaluarTriggerPresupuesto7d();

  // 3. lead_inactivo_n_dias
  detalle.lead_inactivo = await evaluarTriggerLeadInactivo();

  // 4. lead_sin_gestionar_2h (sobre eventos de lead_creado en
  //    Eventos_Sistema, todavía no procesados, con created_at >2h).
  detalle.lead_sin_gestionar = await evaluarTriggerLeadSinGestionar();

  const elapsed = Date.now() - start;
  const totalMatches = Object.values(detalle).reduce(
    (s, d) => s + d.matches,
    0,
  );
  const totalEvaluados = Object.values(detalle).reduce(
    (s, d) => s + d.evaluados,
    0,
  );
  return NextResponse.json({
    ok: true,
    elapsedMs: elapsed,
    evaluados: totalEvaluados,
    matches: totalMatches,
    detalle,
  });
}

// ─── Triggers cron ────────────────────────────────────────────────────

async function evaluarTriggerCita24h() {
  // Busca citas Confirmada con Hora_inicio entre now+23h y now+25h.
  const ahora = Date.now();
  const desde = new Date(ahora + 23 * 3600 * 1000).toISOString();
  const hasta = new Date(ahora + 25 * 3600 * 1000).toISOString();
  const recs = await fetchAll(
    base(TABLES.appointments).select({
      filterByFormula: `AND({Estado}="Confirmada", IS_AFTER({Hora inicio}, "${desde}"), IS_BEFORE({Hora inicio}, "${hasta}"))`,
      pageSize: 100,
    }),
  );
  let evaluados = 0;
  let matches = 0;
  for (const r of recs) {
    evaluados += 1;
    const f = r.fields as Record<string, unknown>;
    const clinicaId = Array.isArray(f["Clínica"])
      ? (f["Clínica"] as string[])[0]
      : null;
    const evento: EventoSistema = {
      tipo: "cita_creada",
      entidadTipo: "Cita",
      entidadId: r.id,
      payload: {
        estado: f["Estado"],
        clinicaId,
        fechaHoraInicio: f["Hora inicio"],
        pacienteId: Array.isArray(f["Paciente"])
          ? (f["Paciente"] as string[])[0]
          : null,
      },
    };
    const reglas = await listReglasActivasParaTrigger(
      "cita_confirmada_24h_antes",
      clinicaId,
    );
    if (reglas.length > 0) matches += 1;
    for (const regla of reglas) await evaluarRegla(regla, evento);
  }
  return { evaluados, matches };
}

async function evaluarTriggerPresupuesto7d() {
  // Presupuestos estado=EN_NEGOCIACION sin actividad >7d.
  const limite = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const recs = await fetchAll(
    base(TABLES.presupuestos).select({
      filterByFormula: `AND({Estado}="EN_NEGOCIACION", OR({UltimoContacto} = BLANK(), IS_BEFORE({UltimoContacto}, "${limite}")))`,
      pageSize: 100,
    }),
  );
  let evaluados = 0;
  let matches = 0;
  for (const r of recs) {
    evaluados += 1;
    const f = r.fields as Record<string, unknown>;
    const clinicaId =
      typeof f["Clinica"] === "string" ? (f["Clinica"] as string) : null;
    const evento: EventoSistema = {
      tipo: "presupuesto_actualizado",
      entidadTipo: "Presupuesto",
      entidadId: r.id,
      payload: {
        estado: f["Estado"],
        clinicaId,
        pacienteId: Array.isArray(f["Paciente_Link"])
          ? (f["Paciente_Link"] as string[])[0]
          : null,
        ultimoContacto: f["UltimoContacto"],
      },
    };
    const reglas = await listReglasActivasParaTrigger(
      "presupuesto_estancado_7d",
      clinicaId,
    );
    if (reglas.length > 0) matches += 1;
    // Dedupe 14d: si ya hubo success de esta regla sobre este presupuesto
    // en últimos 14d, skip — el engine no tiene visibilidad presupuestoId
    // por defecto. Implementación simple: consultamos Acciones_Automatizacion
    // antes de invocar.
    for (const regla of reglas) {
      const ya = await yaDisparadaRecientemente({
        reglaId: regla.id,
        presupuestoId: r.id,
        dias: 14,
      });
      if (ya) continue;
      await evaluarRegla(regla, evento);
    }
  }
  return { evaluados, matches };
}

async function evaluarTriggerLeadInactivo() {
  // Para cada regla activa lead_inactivo_n_dias, leer el parámetro
  // diasSinActividad de su condición (default 60), y buscar leads que
  // cumplen.
  const reglas = await listReglasActivasParaTrigger(
    "lead_inactivo_n_dias",
    null,
  );
  let evaluados = 0;
  let matches = 0;
  for (const regla of reglas) {
    const cond = regla.condiciones.find(
      (c) => c.campo === "diasSinActividad",
    );
    const dias =
      cond && typeof cond.valor === "number" ? (cond.valor as number) : 60;
    const limite = new Date(
      Date.now() - dias * 24 * 3600 * 1000,
    ).toISOString();
    const recs = await fetchAll(
      base(TABLES.leads).select({
        filterByFormula: `AND(OR({Estado}="Contactado", {Estado}="Sin_Respuesta"), OR({UltimaAccion} = BLANK(), IS_BEFORE({UltimaAccion}, "${limite}")))`,
        pageSize: 100,
      }),
    );
    for (const r of recs) {
      evaluados += 1;
      const f = r.fields as Record<string, unknown>;
      const clinicaId = Array.isArray(f["Clinica"])
        ? (f["Clinica"] as string[])[0]
        : null;
      const evento: EventoSistema = {
        tipo: "lead_creado",
        entidadTipo: "Lead",
        entidadId: r.id,
        payload: {
          estado: f["Estado"],
          clinicaId,
          ultimaAccion: f["UltimaAccion"],
          diasSinActividad: dias,
        },
      };
      matches += 1;
      await evaluarRegla(regla, evento);
    }
  }
  return { evaluados, matches };
}

async function evaluarTriggerLeadSinGestionar() {
  // Lee Eventos_Sistema lead_creado no procesados y >2h de antiguedad.
  const dosHoras = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const recs = await fetchAll(
    base(TABLES.eventosSistema).select({
      filterByFormula: `AND({Tipo}="lead_creado", NOT({Procesado}), IS_BEFORE({Created_At}, "${dosHoras}"))`,
      pageSize: 100,
    }),
  );
  let evaluados = 0;
  let matches = 0;
  for (const r of recs) {
    evaluados += 1;
    const f = r.fields as Record<string, unknown>;
    const payloadRaw = String(f["Payload"] ?? "{}");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      /* noop */
    }
    const evento: EventoSistema = {
      tipo: "lead_creado",
      entidadTipo: "Lead",
      entidadId: String(f["Entidad_Id"] ?? ""),
      payload,
    };
    // Solo cuenta si el lead sigue en estado Nuevo (consultamos).
    let estadoActual: string | null = null;
    try {
      const lead = await base(TABLES.leads).find(evento.entidadId);
      estadoActual = String(lead.fields["Estado"] ?? "");
    } catch {
      /* lead borrado, skip */
    }
    if (estadoActual !== "Nuevo") {
      // Marcamos procesado y continuamos.
      await base(TABLES.eventosSistema).update([
        { id: r.id, fields: { Procesado: true } },
      ]);
      continue;
    }
    matches += 1;
    await evaluarReglasParaEvento({
      ...evento,
      payload: { ...payload, estado: estadoActual },
    });
    await base(TABLES.eventosSistema).update([
      { id: r.id, fields: { Procesado: true } },
    ]);
  }
  return { evaluados, matches };
}

// ─── helpers ──────────────────────────────────────────────────────────

async function yaDisparadaRecientemente(args: {
  reglaId: string;
  presupuestoId?: string;
  pacienteId?: string;
  dias: number;
}): Promise<boolean> {
  const desde = new Date(
    Date.now() - args.dias * 24 * 3600 * 1000,
  ).toISOString();
  const partes: string[] = [
    `FIND("${args.reglaId}", ARRAYJOIN({Regla_Link}, ","))`,
    `{Resultado}="success"`,
    `IS_AFTER({Ejecutada_At}, "${desde}")`,
  ];
  if (args.presupuestoId) {
    partes.push(
      `FIND("${args.presupuestoId}", ARRAYJOIN({Presupuesto_Link}, ","))`,
    );
  }
  if (args.pacienteId) {
    partes.push(
      `FIND("${args.pacienteId}", ARRAYJOIN({Paciente_Link}, ","))`,
    );
  }
  const recs = await fetchAll(
    base(TABLES.accionesAutomatizacion).select({
      filterByFormula: `AND(${partes.join(", ")})`,
      maxRecords: 1,
    }),
  );
  return recs.length > 0;
}
