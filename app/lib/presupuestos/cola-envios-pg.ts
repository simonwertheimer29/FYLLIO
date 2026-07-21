// app/lib/presupuestos/cola-envios-pg.ts — FASE 2: dominio Cola_Envios sobre Postgres.
//
// Mismo patrón mini-dominio que notificaciones-pg: se traen las filas del cliente
// (RLS via runWithClienteDb), se mapean a shims con NOMBRES de campo Airtable, y el
// `filterByFormula` que compone el caller se evalúa con el evaluador COMPARTIDO
// (../db/airtable-formula). Cero SQL a medida por consulta; escrituras via Kysely.
//
// D8: presupuesto_ref es TEXT (id de presupuesto ambiguo Airtable/negocio) — se
// pasa tal cual como {Presupuesto}, sin resolver a link.

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[cola-envios-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

// Columna SQL → nombre de campo Airtable (el que leen los callers en `.fields`).
function toShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "Presupuesto": r.presupuesto_ref, // TEXT tal cual (D8)
      "Paciente": r.paciente_nombre,
      "Telefono": r.telefono,
      "Contenido": r.contenido,
      "Tipo": r.tipo,
      "Estado": r.estado,
      "Programado_para": r.programado_para ? iso(r.programado_para) : undefined,
      "Plantilla_usada": r.plantilla_usada,
      "Tratamiento": r.tratamiento,
      "Importe": r.importe != null ? Number(r.importe) : undefined,
      "Doctor": r.doctor,
      "Enviado_en": r.enviado_en ? iso(r.enviado_en) : undefined,
    },
    iso(r.created_at),
  );
}

// Nombre de campo Airtable → columna SQL (para escrituras: create/update).
const COL: Record<string, string> = {
  Presupuesto: "presupuesto_ref",
  Paciente: "paciente_nombre",
  Telefono: "telefono",
  Contenido: "contenido",
  Tipo: "tipo",
  Estado: "estado",
  Programado_para: "programado_para",
  Plantilla_usada: "plantilla_usada",
  Tratamiento: "tratamiento",
  Importe: "importe",
  Doctor: "doctor",
  Enviado_en: "enviado_en",
};

function fieldsToRow(fields: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    const col = COL[k];
    if (!col) continue; // los callers solo mandan campos conocidos (set cerrado auditado)
    row[col] = fields[k];
  }
  return row;
}

export async function selectColaEnviosRawPg(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(`select * from cola_envios order by programado_para asc nulls last, id asc`)
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

// = select sin maxRecords (fetchAll pagina en Airtable; en PG ya viene todo).
export async function selectColaEnviosFetchAllRawPg(opts: {
  filterByFormula?: string;
}): Promise<any[]> {
  return selectColaEnviosRawPg({ filterByFormula: opts.filterByFormula });
}

// Reproduce base(...).find(id): 1 record, LANZA si no existe. Filtro RECORD_ID()
// sobre el evaluador compartido → devuelve un shim idéntico al de las listas.
export async function findColaEnvioRawPg(id: string): Promise<any> {
  const recs = await selectColaEnviosRawPg({ filterByFormula: `RECORD_ID()='${id}'`, maxRecords: 1 });
  if (recs.length === 0) throw new Error(`[cola-envios-pg] no existe envío ${id}`);
  return recs[0];
}

export async function updateColaEnvioRawPg(id: string, fields: Record<string, unknown>): Promise<void> {
  const set = fieldsToRow(fields);
  if (Object.keys(set).length === 0) return;
  await runWithClienteDb(cli(), async (trx) => {
    await trx.updateTable("cola_envios").set(set as any).where("id", "=", id).execute();
  });
}

export async function createColaEnvioRawPg(fields: Record<string, unknown>): Promise<void> {
  const c = cli();
  const row = fieldsToRow(fields);
  await runWithClienteDb(c, async (trx) => {
    await trx.insertInto("cola_envios").values({ cliente: c, ...row } as any).execute();
  });
}
