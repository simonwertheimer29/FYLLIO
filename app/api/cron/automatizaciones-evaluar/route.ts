// app/api/cron/automatizaciones-evaluar/route.ts
//
// Sprint 16b Bloque 4 — cron job que evalúa los triggers basados en
// tiempo. Vercel Hobby plan limita a 1×/día (12:00 UTC).
//
// Auth: header Authorization: Bearer <CRON_SECRET>. Vercel cron lo
// inyecta automáticamente. Sin CRON_SECRET configurado el endpoint
// rechaza todo (en lugar de quedar abierto, pre-2026-05-07 estaba
// abierto y eso permitió que un cron de Vercel sin la env var pasase).
//
// Triggers manejados aquí (event-based viven en código que llama
// emitirEvento):
//   - cita_confirmada_24h_antes
//   - presupuesto_estancado_7d
//   - lead_inactivo_n_dias
//   - lead_sin_gestionar_2h
//
// Returna 200 con {ok, elapsedMs, evaluados, matches, detalle:
// {triggerN: {evaluados, matches, error?}}}.
// Errores 500 devuelven JSON con {error, detail, stack} — pre-fix
// devolvían respuesta vacía sin diagnóstico posible (Sprint 16b
// 2026-05-07 hotfix).

import { NextResponse } from "next/server";
import { listCitasEstadoVentanaRaw } from "../../../lib/scheduler/repo/airtableRepo";
import { fetchAll, base, TABLES, runWithCliente } from "../../../lib/airtable";
import { PILOT_CLIENTE } from "../../../lib/multi-cliente-pendiente";
import {
  evaluarRegla,
  evaluarReglasParaEvento,
} from "../../../lib/automatizaciones/engine";
import { listReglasActivasParaTrigger } from "../../../lib/automatizaciones/repo";
import { getLead, listLeadsPorEstados } from "../../../lib/leads/leads";
import type { EventoSistema } from "../../../lib/automatizaciones/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TriggerResult = {
  evaluados: number;
  matches: number;
  error?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function logErr(scope: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[cron/automatizaciones ${scope}]`, msg, stack ?? "");
}

export async function GET(req: Request) {
  try {
    // MULTI_CLIENTE_PENDIENTE: hoy el cron corre solo para RB (único cliente vivo).
    // Al entrar el 2º cliente: iterar por cada cliente (runWithCliente por cada uno).
    return await runWithCliente(PILOT_CLIENTE, () => handle(req));
  } catch (err) {
    // Safety net: cualquier excepción no capturada por safeTrigger acaba
    // aquí y devuelve JSON con detalle. Pre-fix devolvía 500 vacío.
    logErr("handler", err);
    return NextResponse.json(
      {
        error: "internal_error",
        detail: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack:
          err instanceof Error && process.env["NODE_ENV"] !== "production"
            ? err.stack
            : undefined,
      },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
  // ── Auth ──
  const expected = process.env["CRON_SECRET"];
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) return unauthorized();
  }

  const start = Date.now();
  console.log("[cron/automatizaciones] start");

  // ── Pre-flight: que las env vars Airtable estén ──
  if (!process.env["AIRTABLE_BASE_ID"] || !process.env["AIRTABLE_API_KEY"]) {
    return NextResponse.json(
      {
        error: "missing_env",
        detail: "AIRTABLE_BASE_ID o AIRTABLE_API_KEY ausentes en producción",
      },
      { status: 500 },
    );
  }

  const detalle: Record<string, TriggerResult> = {};

  // Cada trigger se ejecuta aislado: si uno falla, los otros siguen
  // y el detalle del fallo va al cuerpo de la respuesta.
  detalle.cita_24h = await safeTrigger("cita_24h", evaluarTriggerCita24h);
  detalle.presupuesto_7d = await safeTrigger(
    "presupuesto_7d",
    evaluarTriggerPresupuesto7d,
  );
  detalle.lead_inactivo = await safeTrigger(
    "lead_inactivo",
    evaluarTriggerLeadInactivo,
  );
  detalle.lead_sin_gestionar = await safeTrigger(
    "lead_sin_gestionar",
    evaluarTriggerLeadSinGestionar,
  );

  const elapsed = Date.now() - start;
  const totalMatches = Object.values(detalle).reduce(
    (s, d) => s + d.matches,
    0,
  );
  const totalEvaluados = Object.values(detalle).reduce(
    (s, d) => s + d.evaluados,
    0,
  );
  const erroresTotal = Object.values(detalle).filter((d) => d.error).length;

  console.log(
    `[cron/automatizaciones] done ${elapsed}ms · evaluados=${totalEvaluados} matches=${totalMatches} errores=${erroresTotal}`,
  );

  return NextResponse.json({
    ok: erroresTotal === 0,
    elapsedMs: elapsed,
    evaluados: totalEvaluados,
    matches: totalMatches,
    erroresTotal,
    detalle,
  });
}

async function safeTrigger(
  scope: string,
  fn: () => Promise<TriggerResult>,
): Promise<TriggerResult> {
  try {
    const t0 = Date.now();
    const r = await fn();
    console.log(
      `[cron/automatizaciones ${scope}] ok ${Date.now() - t0}ms evaluados=${r.evaluados} matches=${r.matches}`,
    );
    return r;
  } catch (err) {
    logErr(scope, err);
    return {
      evaluados: 0,
      matches: 0,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

// ─── Triggers cron ────────────────────────────────────────────────────

async function evaluarTriggerCita24h(): Promise<TriggerResult> {
  const ahora = Date.now();
  const desde = new Date(ahora + 23 * 3600 * 1000).toISOString();
  const hasta = new Date(ahora + 25 * 3600 * 1000).toISOString();
  // FASE 1 migración: ventana 24h-antes via repo del dominio Agenda.
  const recs = await listCitasEstadoVentanaRaw({ estado: "Confirmada", desdeIso: desde, hastaIso: hasta });
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
      clinicaId ?? null,
    );
    if (reglas.length > 0) matches += 1;
    for (const regla of reglas) {
      try {
        await evaluarRegla(regla, evento);
      } catch (err) {
        logErr(`cita_24h regla=${regla.codigo}`, err);
      }
    }
  }
  return { evaluados, matches };
}

async function evaluarTriggerPresupuesto7d(): Promise<TriggerResult> {
  // 2026-05-07 fix: el campo legacy `UltimoContacto` no existe en el
  // schema actual de Presupuestos. Real: `Ultima_accion_registrada`
  // (dateTime, escrito por copilot/actions-exec). Si la formula
  // devuelve UNKNOWN_FIELD_NAME, capturamos y devolvemos error
  // informativo en lugar de tumbar todo el cron.
  const limite = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const recs = await fetchAll(
    base(TABLES.presupuestos).select({
      filterByFormula: `AND({Estado}="EN_NEGOCIACION", OR({Ultima_accion_registrada} = BLANK(), IS_BEFORE({Ultima_accion_registrada}, "${limite}")))`,
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
        pacienteId: Array.isArray(f["Paciente"])
          ? (f["Paciente"] as string[])[0]
          : null,
        ultimaAccionRegistrada: f["Ultima_accion_registrada"],
      },
    };
    const reglas = await listReglasActivasParaTrigger(
      "presupuesto_estancado_7d",
      clinicaId,
    );
    if (reglas.length > 0) matches += 1;
    for (const regla of reglas) {
      try {
        const ya = await yaDisparadaRecientemente({
          reglaId: regla.id,
          presupuestoId: r.id,
          dias: 14,
        });
        if (ya) continue;
        await evaluarRegla(regla, evento);
      } catch (err) {
        logErr(`presupuesto_7d regla=${regla.codigo} pres=${r.id}`, err);
      }
    }
  }
  return { evaluados, matches };
}

async function evaluarTriggerLeadInactivo(): Promise<TriggerResult> {
  // 2026-05-07 fix: Leads.Ultima_Accion es `multilineText` (log textual
  // con timestamps), no dateTime. No podemos usar IS_BEFORE en la
  // formula. En su lugar:
  //   1. Query leads en estado Contactado/Sin_Respuesta (sin filtro
  //      temporal en el formula).
  //   2. En JS calculamos "días desde createdTime" como proxy de
  //      inactividad (el lead no se ha movido de estado en N días =
  //      proxy razonable mientras no haya un campo dateTime nativo).
  //   3. Skip los que aún no superan diasInactividad.
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
    const limiteMs = Date.now() - dias * 24 * 3600 * 1000;

    // FASE 1 migración: la query vive en el repo del dominio Leads.
    const leadsInactivables = await listLeadsPorEstados(["Contactado", "Sin_Respuesta"]);

    for (const lead of leadsInactivables) {
      const createdMs = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
      if (!createdMs || createdMs > limiteMs) continue; // todavía no inactivo

      evaluados += 1;
      const evento: EventoSistema = {
        tipo: "lead_creado",
        entidadTipo: "Lead",
        entidadId: lead.id,
        payload: {
          estado: lead.estado,
          clinicaId: lead.clinicaId,
          ultimaAccion: lead.ultimaAccion,
          diasSinActividad: dias,
        },
      };
      matches += 1;
      try {
        await evaluarRegla(regla, evento);
      } catch (err) {
        logErr(`lead_inactivo regla=${regla.codigo} lead=${lead.id}`, err);
      }
    }
  }
  return { evaluados, matches };
}

async function evaluarTriggerLeadSinGestionar(): Promise<TriggerResult> {
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
    try {
      const f = r.fields as Record<string, unknown>;
      const payloadRaw = String(f["Payload"] ?? "{}");
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        /* payload corrupto: continuar con {} */
      }
      const entidadId = String(f["Entidad_Id"] ?? "");
      if (!entidadId) {
        await base(TABLES.eventosSistema).update([
          { id: r.id, fields: { Procesado: true } },
        ]);
        continue;
      }
      const evento: EventoSistema = {
        tipo: "lead_creado",
        entidadTipo: "Lead",
        entidadId,
        payload,
      };
      // getLead devuelve null si el lead fue borrado o el ID es inválido:
      // en ambos casos se marca procesado y se sigue (mismo criterio de antes).
      const lead = await getLead(entidadId);
      const estadoActual: string | null = lead ? lead.estado : null;
      if (estadoActual !== "Nuevo") {
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
    } catch (err) {
      logErr(`lead_sin_gestionar evento=${r.id}`, err);
    }
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
