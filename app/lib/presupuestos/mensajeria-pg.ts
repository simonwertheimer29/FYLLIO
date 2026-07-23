// app/lib/presupuestos/mensajeria-pg.ts — FASE 2: tabla Mensajes_WhatsApp (el LOG) sobre Postgres.
//
// Solo el registro de mensajes (create/select). La idempotencia (KV), el envío a
// Meta (WABA), el rate-limit y la telemetría WABA NO se tocan — viven en
// mensajeria.ts y son ortogonales a en qué backend se guarda el log.
//
// FK compuestas (D8): paciente_id→pacientes, presupuesto_id→presupuestos,
// lead_id→leads. Airtable guardaba "" como texto; aquí "" → null (la FK exige
// existencia o null). Un id real debe existir en el cliente (RLS + FK).

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[mensajeria-pg] sin cliente (fail-closed)");
  return c;
}
const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const refOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function toShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "Paciente": r.paciente_id ?? undefined,
      "Presupuesto": r.presupuesto_id ?? undefined,
      "Lead_Link": r.lead_id ? [r.lead_id] : undefined,
      "Telefono": r.telefono,
      "Direccion": r.direccion,
      "Contenido": r.contenido,
      "Timestamp": r.timestamp ? iso(r.timestamp) : undefined,
      "Fuente": r.fuente,
      "Procesado_por_IA": r.procesado_por_ia,
      "Intencion_detectada": r.intencion_detectada ?? undefined,
      "WABA_message_id": r.waba_message_id ?? undefined,
      "Notas": r.notas ?? undefined,
    },
    iso(r.created_at),
  );
}

export async function selectMensajesWhatsAppPg(opts: {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(`select * from mensajes_whatsapp order by timestamp asc nulls last, id asc`)
      .execute(trx);
    return r.rows as any[];
  });
  let recs = rows.map(toShim);
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.sort?.length) {
    const { field, direction } = opts.sort[0]!;
    const key = (x: Shim) => String(x.fields[field] ?? "");
    recs.sort((a, b) => (direction === "desc" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
  }
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}

export type UltimosPorConversacion = Map<
  string,
  { entranteAt: string | null; salienteAt: string | null }
>;

/**
 * Último mensaje entrante/saliente por conversación, agrupado en SQL —
 * alimenta estadoConversacion en las colas (presupuestos y leads) sin traer
 * el hilo entero de cada caso.
 */
export async function ultimosMensajesPorConversacionPg(): Promise<{
  porPresupuesto: UltimosPorConversacion;
  porLead: UltimosPorConversacion;
}> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(
        `select presupuesto_id, lead_id, direccion, max(timestamp) as t
         from mensajes_whatsapp
         where timestamp is not null and (presupuesto_id is not null or lead_id is not null)
         group by presupuesto_id, lead_id, direccion`,
      )
      .execute(trx);
    return r.rows as any[];
  });
  const porPresupuesto: UltimosPorConversacion = new Map();
  const porLead: UltimosPorConversacion = new Map();
  const meter = (map: UltimosPorConversacion, id: string, direccion: string, t: string) => {
    const cur = map.get(id) ?? { entranteAt: null, salienteAt: null };
    if (direccion === "Entrante") {
      if (!cur.entranteAt || t > cur.entranteAt) cur.entranteAt = t;
    } else {
      if (!cur.salienteAt || t > cur.salienteAt) cur.salienteAt = t;
    }
    map.set(id, cur);
  };
  for (const r of rows) {
    const t = iso(r.t);
    if (!t) continue;
    if (r.presupuesto_id) meter(porPresupuesto, String(r.presupuesto_id), String(r.direccion), t);
    if (r.lead_id) meter(porLead, String(r.lead_id), String(r.direccion), t);
  }
  return { porPresupuesto, porLead };
}

/** Inserta un registro de mensaje y devuelve el shape mínimo que leen los callers ({ id }). */
export async function createMensajeWhatsAppPg(fields: Record<string, unknown>): Promise<{ id: string }> {
  const leadLink = fields["Lead_Link"];
  const row = {
    cliente: cli(),
    paciente_id: refOrNull(fields["Paciente"]),
    presupuesto_id: refOrNull(fields["Presupuesto"]),
    lead_id: Array.isArray(leadLink) ? refOrNull(leadLink[0]) : refOrNull(leadLink),
    telefono: fields["Telefono"] == null ? null : String(fields["Telefono"]),
    direccion: String(fields["Direccion"] ?? "Entrante"),
    contenido: fields["Contenido"] == null ? null : String(fields["Contenido"]),
    timestamp: fields["Timestamp"] == null ? null : String(fields["Timestamp"]),
    fuente: fields["Fuente"] == null ? null : String(fields["Fuente"]),
    procesado_por_ia: Boolean(fields["Procesado_por_IA"] ?? false),
    intencion_detectada: refOrNull(fields["Intencion_detectada"]),
    waba_message_id: refOrNull(fields["WABA_message_id"]),
    notas: refOrNull(fields["Notas"]),
  };
  const inserted = await runWithClienteDb(cli(), async (trx) => {
    return trx.insertInto("mensajes_whatsapp").values(row as any).returning("id").executeTakeFirstOrThrow();
  });
  return { id: (inserted as any).id };
}
