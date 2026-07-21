// app/lib/presupuestos/notificaciones-pg.ts — FASE 2: dominio Notificaciones sobre Postgres.
//
// Plantilla del patrón mini-dominio: se traen las filas del cliente (RLS via
// runWithClienteDb), se mapean a shims con NOMBRES de campo Airtable, y el
// `filterByFormula` que compone el caller se evalúa con el evaluador COMPARTIDO
// (../db/airtable-formula). Cero SQL a medida por consulta.

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[notificaciones-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

function toShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "Usuario": r.usuario,
      "Tipo": r.tipo,
      "Titulo": r.titulo,
      "Mensaje": r.mensaje,
      "Link": r.link,
      "Leida": r.leida, // boolean — makeShim NO descarta false (el filtro usa {Leida}=FALSE())
      "Fecha_creacion": r.fecha_creacion ? iso(r.fecha_creacion) : undefined,
    },
    iso(r.created_at),
  );
}

export async function selectNotificacionesRawPg(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(`select * from notificaciones order by fecha_creacion desc nulls last, id asc`)
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

export async function crearNotificacionPg(args: {
  usuario?: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  link?: string;
}): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    await trx
      .insertInto("notificaciones")
      .values({
        cliente: cli(),
        usuario: args.usuario ?? "todos",
        tipo: args.tipo,
        titulo: args.titulo,
        mensaje: args.mensaje,
        link: args.link ?? "/presupuestos",
        leida: false,
        fecha_creacion: new Date().toISOString(),
      } as any)
      .execute();
  });
}

export async function updateNotificacionesBatchRawPg(
  batch: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<void> {
  if (!batch.length) return;
  await runWithClienteDb(cli(), async (trx) => {
    for (const item of batch) {
      const set: Record<string, unknown> = {};
      if ("Leida" in item.fields) set.leida = item.fields["Leida"];
      if (Object.keys(set).length === 0) continue;
      await trx.updateTable("notificaciones").set(set as any).where("id", "=", item.id).execute();
    }
  });
}
