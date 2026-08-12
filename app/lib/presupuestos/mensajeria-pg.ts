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
/**
 * Entrantes seguidos SIN respuesta nuestra, por presupuesto. Alimenta la regla
 * de los dos intentos de la ambigüedad.
 *
 * Se DERIVA del hilo en una sola consulta: cero estado nuevo, y el contador se
 * reinicia solo en cuanto sale un saliente — porque entonces ya no hay entrantes
 * posteriores a él.
 */
export async function entrantesSinResponderPg(): Promise<Map<string, number>> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(
        `select m.presupuesto_id, count(*)::int as n
         from mensajes_whatsapp m
         where m.presupuesto_id is not null
           and m.direccion = 'Entrante'
           and m.timestamp is not null
           and m.timestamp > coalesce(
                 (select max(s.timestamp) from mensajes_whatsapp s
                  where s.presupuesto_id = m.presupuesto_id and s.direccion = 'Saliente'),
                 '-infinity'::timestamptz)
         group by m.presupuesto_id`,
      )
      .execute(trx);
    return r.rows as any[];
  });
  return new Map(rows.map((r) => [String(r.presupuesto_id), Number(r.n) || 0]));
}

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

/** TEXTO del último entrante por lead (≡ rama Airtable en mensajeria.ts). */
export async function ultimoEntranteTextoPorLeadPg(): Promise<Record<string, string>> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(
        `select distinct on (lead_id) lead_id, contenido
         from mensajes_whatsapp
         where lead_id is not null and direccion = 'Entrante'
           and timestamp is not null and contenido is not null
         order by lead_id, timestamp desc`,
      )
      .execute(trx);
    return r.rows as any[];
  });
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.lead_id && r.contenido) out[String(r.lead_id)] = String(r.contenido);
  }
  return out;
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
    // 018 — los tres cimientos de Mensajería. `autor` solo se escribe en
    // salientes: en un entrante quien escribió es el paciente y ponerle una
    // etiqueta de las nuestras sería inventar.
    autor: refOrNull(fields["Autor"]),
    sugerido_por_ia:
      fields["Sugerido_por_IA"] == null ? null : Boolean(fields["Sugerido_por_IA"]),
    nombre_perfil: refOrNull(fields["Nombre_perfil"]),
    // 019 — la clínica se escribe al recibir o enviar. Si el caller no la sabe
    // queda NULL, que la bandeja lee como «todavía no se sabe», no como «todas».
    clinica_id: refOrNull(fields["Clinica_id"]),
  };
  const inserted = await runWithClienteDb(cli(), async (trx) => {
    // ─── Completar el caso ANTES de insertar (§6) ─────────────────────
    //
    // «Registrar respuesta» manda solo presupuesto_id; el webhook, según el
    // match, solo lead_id. Sin esto, el mensaje se insertaba sin paciente ni
    // clínica y el ÚLTIMO mensaje del hilo degradaba la conversación entera
    // (el fallo del 12 ago: Cristina Muñoz convertida en un teléfono pelado
    // «sin clínica»). Se resuelve aquí, en el único punto de escritura, para
    // que ningún caller pueda olvidarlo.
    if (row.presupuesto_id && (!row.paciente_id || !row.clinica_id)) {
      const pres = await trx
        .selectFrom("presupuestos")
        .select(["paciente_id", "clinica_id"])
        .where("id", "=", row.presupuesto_id)
        .executeTakeFirst();
      if (pres) {
        row.paciente_id = row.paciente_id ?? pres.paciente_id ?? null;
        row.clinica_id = row.clinica_id ?? pres.clinica_id ?? null;
      }
    } else if (row.lead_id && !row.clinica_id) {
      const lead = await trx
        .selectFrom("leads")
        .select(["clinica_id"])
        .where("id", "=", row.lead_id)
        .executeTakeFirst();
      if (lead) row.clinica_id = lead.clinica_id ?? null;
    }
    return trx.insertInto("mensajes_whatsapp").values(row as any).returning("id").executeTakeFirstOrThrow();
  });
  return { id: (inserted as any).id };
}

/** ¿Existe ya un entrante idéntico y reciente en este hilo? (§2 — dedup del
 *  registro manual: el mismo texto registrado dos veces en un par de minutos
 *  es un doble clic, no dos mensajes del paciente. El webhook tiene su propio
 *  dedup por waba_message_id; este cubre el camino SIN id de Meta.) */
export async function entranteDuplicadoRecientePg(args: {
  telefono: string;
  contenido: string;
  ventanaMinutos: number;
}): Promise<string | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx
      .selectFrom("mensajes_whatsapp")
      .select("id")
      .where("telefono", "=", args.telefono)
      .where("direccion", "=", "Entrante")
      .where("contenido", "=", args.contenido)
      .where(
        "timestamp",
        ">",
        new Date(Date.now() - args.ventanaMinutos * 60_000),
      )
      .executeTakeFirst();
    return r?.id ? String(r.id) : null;
  });
}
