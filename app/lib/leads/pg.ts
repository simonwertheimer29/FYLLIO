// app/lib/leads/pg.ts
//
// FASE 2 gate 3 — implementación Postgres del dominio Leads. Devuelve
// EXACTAMENTE los mismos shapes que la implementación Airtable (Lead,
// AccionLead, PlantillaLead y los maps de ultima-saliente): la paridad se
// verifica con goldens en el mismo instante. El cliente sale del contexto
// de runWithCliente (los callers no cambian); cada operación abre su
// transacción RLS via runWithClienteDb.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import type { Lead, LeadEstado, ListLeadsParams } from "./leads";
import type { AccionLead, TipoAccionLead } from "./acciones";
import type { PlantillaLead } from "./plantillas";

function clienteActual(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[leads-pg] sin cliente en contexto (fail-closed)");
  return c;
}

const iso = (v: Date | string | null | undefined): string =>
  v == null ? "" : v instanceof Date ? v.toISOString() : String(v);

function rowToLead(r: any): Lead {
  return {
    id: r.id,
    nombre: r.nombre ?? "",
    telefono: r.telefono,
    email: r.email,
    tratamiento: r.tratamiento_interes,
    canal: r.canal_captacion,
    estado: (r.estado ?? "Nuevo") as LeadEstado,
    clinicaId: r.clinica_id,
    fechaCita: r.fecha_cita,
    horaCita: r.hora_cita,
    doctorAsignadoId: r.doctor_asignado_id,
    tipoVisita: r.tipo_visita,
    motivoNoInteres: r.motivo_no_interes,
    intencionDetectada: r.intencion_detectada,
    mensajeSugerido: r.mensaje_sugerido,
    accionSugerida: r.accion_sugerida,
    llamado: Boolean(r.llamado),
    whatsappEnviados: Number(r.whatsapp_enviados ?? 0),
    ultimaAccion: r.ultima_accion,
    notas: r.notas,
    convertido: Boolean(r.convertido_a_paciente),
    pacienteId: r.paciente_id,
    asistido: Boolean(r.asistido),
    createdAt: iso(r.created_at),
  };
}

export async function listLeadsPg(params: ListLeadsParams = {}): Promise<Lead[]> {
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("leads").selectAll().orderBy("created_at", "asc").orderBy("id", "asc").execute();
    let leads = rows.map(rowToLead);
    // Filtros en JS — MISMO criterio que la implementación Airtable.
    if (params.clinicaIds && params.clinicaIds.length > 0) {
      const set = new Set(params.clinicaIds);
      leads = leads.filter((l) => l.clinicaId && set.has(l.clinicaId));
    }
    if (params.estado) leads = leads.filter((l) => l.estado === params.estado);
    if (params.search) {
      const q = params.search.toLowerCase().trim();
      if (q) leads = leads.filter((l) =>
        l.nombre.toLowerCase().includes(q) ||
        (l.telefono ?? "").toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q));
    }
    if (params.fechaDesde) leads = leads.filter((l) => l.createdAt >= params.fechaDesde!);
    if (params.fechaHasta) leads = leads.filter((l) => l.createdAt <= params.fechaHasta!);
    return leads;
  });
}

export async function getLeadPg(id: string): Promise<Lead | null> {
  try {
    return await runWithClienteDb(clienteActual(), async (trx) => {
      const r = await trx.selectFrom("leads").selectAll().where("id", "=", id).executeTakeFirst();
      return r ? rowToLead(r) : null;
    });
  } catch { return null; }
}

export async function listLeadsPorEstadosPg(estados: string[]): Promise<Lead[]> {
  if (estados.length === 0) return [];
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("leads").selectAll().where("estado", "in", estados as any).orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return rows.map(rowToLead);
  });
}

export async function buscarLeadActivoPorTelefonoPg(
  telefonoNormalizado: string,
): Promise<{ id: string; clinicaId?: string } | null> {
  try {
    return await runWithClienteDb(clienteActual(), async (trx) => {
      const r = await trx
        .selectFrom("leads")
        .select(["id", "clinica_id"])
        .where("convertido_a_paciente", "=", false)
        .where(
          sql<boolean>`replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + telefonoNormalizado + "%"}`,
        )
        .limit(1)
        .executeTakeFirst();
      if (!r) return null;
      return { id: r.id, clinicaId: r.clinica_id ?? undefined };
    });
  } catch (err) {
    console.error("[leads-pg] buscarLeadActivoPorTelefono:", err instanceof Error ? err.message : "error");
    return null;
  }
}

type CreateLeadInput = Parameters<typeof import("./leads").createLead>[0];

export async function createLeadPg(input: CreateLeadInput): Promise<Lead> {
  const row = await runWithClienteDb(clienteActual(), async (trx) => {
    return trx
      .insertInto("leads")
      .values({
        cliente: clienteActual(),
        nombre: input.nombre,
        estado: (input.estado ?? "Nuevo") as LeadEstado,
        clinica_id: input.clinicaId,
        whatsapp_enviados: 0,
        llamado: false,
        convertido_a_paciente: false,
        telefono: input.telefono ?? null,
        email: input.email ?? null,
        tratamiento_interes: input.tratamiento ?? null,
        canal_captacion: input.canal ?? null,
        fecha_cita: input.fechaCita ?? null,
        notas: input.notas ?? null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  const lead = rowToLead(row);
  // MISMO side-effect que la implementación Airtable: emitir lead_creado
  // fire-and-forget (la delegación retornaba antes y se lo saltaba).
  void (async () => {
    try {
      const { emitirEvento } = await import("../automatizaciones/engine");
      await emitirEvento({
        tipo: "lead_creado",
        entidadTipo: "Lead",
        entidadId: lead.id,
        payload: { clinicaId: lead.clinicaId, estado: lead.estado, canal: lead.canal, tratamiento: lead.tratamiento },
      });
    } catch (err) {
      console.error("[automatizaciones createLeadPg] emit falló:", err);
    }
  })();
  return lead;
}

const PATCH_COLS: Record<string, string> = {
  nombre: "nombre", telefono: "telefono", email: "email", tratamiento: "tratamiento_interes",
  canal: "canal_captacion", estado: "estado", clinicaId: "clinica_id", fechaCita: "fecha_cita",
  horaCita: "hora_cita", doctorAsignadoId: "doctor_asignado_id", tipoVisita: "tipo_visita",
  motivoNoInteres: "motivo_no_interes", intencionDetectada: "intencion_detectada",
  mensajeSugerido: "mensaje_sugerido", accionSugerida: "accion_sugerida", llamado: "llamado",
  whatsappEnviados: "whatsapp_enviados", ultimaAccion: "ultima_accion", notas: "notas",
  asistido: "asistido",
};

export async function updateLeadPg(id: string, patch: Record<string, unknown>): Promise<Lead> {
  const set: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(PATCH_COLS)) {
    if (patch[k] !== undefined) set[col] = patch[k] ?? null;
  }
  const row = await runWithClienteDb(clienteActual(), async (trx) =>
    trx.updateTable("leads").set(set as any).where("id", "=", id).returningAll().executeTakeFirstOrThrow(),
  );
  return rowToLead(row);
}

export async function appendLeadLogPg(leadId: string, event: string): Promise<void> {
  try {
    await runWithClienteDb(clienteActual(), async (trx) => {
      const stamp = new Date().toISOString().replace(".000Z", "Z");
      const line = `[${stamp}] ${event}`;
      await sql`update leads set ultima_accion = coalesce(ultima_accion || E'\\n', '') || ${line} where id = ${leadId}`.execute(trx);
    });
  } catch { /* silencioso: mismo criterio que Airtable */ }
}

export async function markLeadConvertidoPg(leadId: string, pacienteId: string): Promise<Lead> {
  const row = await runWithClienteDb(clienteActual(), async (trx) =>
    trx.updateTable("leads")
      .set({ convertido_a_paciente: true, paciente_id: pacienteId } as any)
      .where("id", "=", leadId).returningAll().executeTakeFirstOrThrow(),
  );
  return rowToLead(row);
}

// ─── Acciones_Lead ────────────────────────────────────────────────────

function rowToAccion(r: any): AccionLead {
  return {
    id: r.id,
    leadId: r.lead_id ?? "",
    tipo: (r.tipo_accion ?? "Nota") as TipoAccionLead,
    timestamp: iso(r.timestamp ?? r.created_at),
    usuarioId: r.usuario_id ?? undefined,
    detalles: r.detalles ?? undefined,
  };
}

export async function logAccionLeadPg(args: {
  leadId: string; tipo: TipoAccionLead; usuarioId?: string; detalles?: string; timestamp?: string;
}): Promise<void> {
  try {
    const t = args.timestamp ?? new Date().toISOString();
    const tsHumano = t.replace("T", " ").slice(0, 16);
    await runWithClienteDb(clienteActual(), async (trx) => {
      await trx.insertInto("acciones_lead").values({
        cliente: clienteActual(),
        resumen: `${args.tipo} · ${tsHumano}`,
        lead_id: args.leadId,
        tipo_accion: args.tipo,
        timestamp: new Date(t),
        detalles: args.detalles ?? null,
      } as any).execute();
    });
  } catch (err) {
    console.error("[acciones-lead pg] error logging:", err instanceof Error ? err.message : err);
  }
}

export async function crearAccionAutomatizacionPg(input: {
  leadId: string; tipo: string; descripcion: string;
}): Promise<void> {
  await runWithClienteDb(clienteActual(), async (trx) => {
    await trx.insertInto("acciones_lead").values({
      cliente: clienteActual(),
      lead_id: input.leadId,
      tipo: input.tipo,
      descripcion: input.descripcion,
      timestamp: new Date(),
    } as any).execute();
  });
}

export async function listAccionesDesdePg(
  desde: Date, clinicaIdsAllowed?: string[] | null,
): Promise<AccionLead[]> {
  try {
    return await runWithClienteDb(clienteActual(), async (trx) => {
      const rows = await trx.selectFrom("acciones_lead").selectAll().where("timestamp", ">", desde).orderBy("timestamp", "asc").orderBy("id", "asc").execute();
      let acciones = rows.map(rowToAccion);
      if (clinicaIdsAllowed && clinicaIdsAllowed.length > 0) {
        const leadIds = Array.from(new Set(acciones.map((a) => a.leadId).filter(Boolean)));
        if (leadIds.length === 0) return [];
        const leadRows = await trx.selectFrom("leads").select(["id", "clinica_id"]).where("id", "in", leadIds).execute();
        const allowed = new Set(clinicaIdsAllowed);
        const leadToClinica = new Map(leadRows.map((l) => [l.id, l.clinica_id]));
        acciones = acciones.filter((a) => {
          const cli = leadToClinica.get(a.leadId);
          return cli && allowed.has(cli);
        });
      }
      return acciones;
    });
  } catch (err) {
    console.error("[acciones-lead pg] listAccionesDesde error:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function ultimasAccionesDireccionPorLeadPg(): Promise<{
  salientePorLead: Record<string, string>; entrantePorLead: Record<string, string>;
}> {
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("acciones_lead")
      .select(["lead_id", "timestamp", "tipo_accion", "created_at"])
      .where("tipo_accion", "in", ["Llamada", "WhatsApp_Saliente", "WhatsApp_Entrante"])
      .execute();
    const salientePorLead: Record<string, string> = {};
    const entrantePorLead: Record<string, string> = {};
    for (const r of rows) {
      const lid = r.lead_id;
      if (!lid) continue;
      const t = iso(r.timestamp ?? r.created_at);
      if (!t) continue;
      const map = r.tipo_accion === "WhatsApp_Entrante" ? entrantePorLead : salientePorLead;
      if (!map[lid] || t > map[lid]) map[lid] = t;
    }
    return { salientePorLead, entrantePorLead };
  });
}

export async function listAccionesByLeadPg(leadId: string): Promise<AccionLead[]> {
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("acciones_lead").selectAll().where("lead_id", "=", leadId).execute();
    return rows.map(rowToAccion).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });
}

export async function ultimaCobranzaPorLeadPg(): Promise<Map<string, string>> {
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("acciones_lead")
      .select(["lead_id", "timestamp"])
      .where("detalles", "like", "%[Cobranza]%")
      .execute();
    const out = new Map<string, string>();
    for (const r of rows) {
      if (!r.lead_id || !r.timestamp) continue;
      const t = iso(r.timestamp);
      const prev = out.get(r.lead_id);
      if (!prev || t > prev) out.set(r.lead_id, t);
    }
    return out;
  });
}

export async function primeraAccionLeadTimestampPg(): Promise<string | null> {
  try {
    return await runWithClienteDb(clienteActual(), async (trx) => {
      const r = await trx.selectFrom("acciones_lead").select("timestamp")
        .orderBy("timestamp", "asc").limit(1).executeTakeFirst();
      return r ? iso(r.timestamp) : null;
    });
  } catch { return null; }
}

// ─── Plantillas_Lead ──────────────────────────────────────────────────

export async function listPlantillasLeadActivasPg(): Promise<PlantillaLead[]> {
  return runWithClienteDb(clienteActual(), async (trx) => {
    const rows = await trx.selectFrom("plantillas_lead").selectAll()
      .where("activa", "=", true).orderBy("tipo", "asc").orderBy("id", "asc").execute();
    return rows.map((r: any) => ({
      id: r.id,
      nombre: r.nombre ?? "",
      tipo: (r.tipo ?? "Primer_Contacto") as PlantillaLead["tipo"],
      contenido: r.contenido ?? "",
    }));
  });
}

/** Mismo criterio que listAccionesHoy de Airtable: desde hoy T00:00Z. */
export async function listAccionesHoyPgShim(params: {
  clinicaIdsAllowed?: string[] | null;
} = {}): Promise<AccionLead[]> {
  const today = new Date().toISOString().slice(0, 10);
  return listAccionesDesdePg(new Date(`${today}T00:00:00.000Z`), params.clinicaIdsAllowed);
}
