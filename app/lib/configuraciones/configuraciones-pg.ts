// app/lib/configuraciones/configuraciones-pg.ts — FASE 2: dominio Configuraciones sobre Postgres.
//
// Patrón mini-dominio (mismo que notificaciones-pg): las filas del cliente se
// traen via runWithClienteDb (aislamiento por RLS), se mapean a shims con
// NOMBRES de campo Airtable, y los filterByFormula que componen los callers y
// consumidores (horario laboral, llamadas IA, motor no-shows) se evalúan con el
// evaluador COMPARTIDO (../db/airtable-formula) — cero SQL a medida por consulta.
//
// LINK Airtable `Clinica_Link` (array ["recX"]) ⇄ columna PG `clinica_id`:
//   · al ESCRIBIR: se toma el primer elemento del array → clinica_id (null = global).
//   · al LEER: clinica_id → Clinica_Link:[clinica_id] en el shim, para que
//     FIND("id", ARRAYJOIN({Clinica_Link},",")) y los consumidores que leen
//     `.fields["Clinica_Link"]` funcionen idénticos a Airtable.
//
// La proyección a ConfigOpcion reusa toOpcion() de configuraciones.ts sobre el
// shim → paridad exacta garantizada con el backend Airtable (una sola verdad).

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";
import { toOpcion, type ConfigCategoria, type ConfigOpcion } from "./configuraciones";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[configuraciones-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

/** Row PG → Shim con NOMBRES Airtable (los que esperan toOpcion y los consumidores). */
function toShim(r: any): Shim {
  const fields: Record<string, unknown> = {
    Resumen: r.resumen,
    Categoria: r.categoria,
    Valor: r.valor,
    Activo: r.activo, // boolean — makeShim NO descarta false (activo:false debe leerse false)
    Orden: r.orden, // number — makeShim NO descarta 0
    Created_At: r.created_at ? iso(r.created_at) : undefined,
  };
  // LINK: clinica_id (columna) → Clinica_Link:[id] (array), como en Airtable.
  if (r.clinica_id) fields.Clinica_Link = [r.clinica_id];
  return makeShim(r.id, fields, iso(r.created_at));
}

/** Traduce fields con NOMBRES Airtable → columnas PG (para create/update Raw). */
function fieldsToColumns(fields: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if ("Resumen" in fields) set.resumen = fields.Resumen ?? null;
  if ("Categoria" in fields) set.categoria = fields.Categoria ?? null;
  if ("Valor" in fields) set.valor = fields.Valor ?? null;
  if ("Activo" in fields) set.activo = fields.Activo;
  if ("Orden" in fields) set.orden = fields.Orden;
  if (fields.Created_At) set.created_at = new Date(String(fields.Created_At));
  // LINK Clinica_Link (array) → clinica_id (primer elemento; [] o ausente = global/null).
  if ("Clinica_Link" in fields) {
    const links = fields.Clinica_Link;
    set.clinica_id = Array.isArray(links) ? ((links[0] as string) ?? null) : null;
  }
  return set;
}

async function selectAllShims(): Promise<Shim[]> {
  const rows = await runWithClienteDb(cli(), (trx) =>
    trx
      .selectFrom("configuraciones_clinica")
      .selectAll()
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),
  );
  return rows.map(toShim);
}

// ── lecturas ──────────────────────────────────────────────────────────────

export async function listAllOpcionesPg(): Promise<ConfigOpcion[]> {
  return (await selectAllShims()).map(toOpcion);
}

export async function findConfigClinicaRawPg(id: string): Promise<any> {
  const row = await runWithClienteDb(cli(), (trx) =>
    trx.selectFrom("configuraciones_clinica").selectAll().where("id", "=", id).executeTakeFirst(),
  );
  if (!row) throw new Error(`[configuraciones-pg] config ${id} no encontrada`);
  return toShim(row);
}

export async function findConfigPorCategoriaYClinicaRawPg(
  categoria: string,
  clinicaId: string,
): Promise<any | null> {
  // Misma fórmula que el caller Airtable — evaluada sobre shims (Clinica_Link:[id]).
  const formula = `AND({Categoria}="${categoria}", FIND("${clinicaId}", ARRAYJOIN({Clinica_Link}, ",")))`;
  const recs = await selectAllShims();
  return recs.find((rec) => evalFormula(formula, { rec })) ?? null;
}

export async function selectConfigsPorCategoriaRawPg(categoria: string): Promise<any[]> {
  const formula = `{Categoria}="${categoria}"`;
  const recs = await selectAllShims();
  return recs.filter((rec) => evalFormula(formula, { rec }));
}

// ── escrituras ──────────────────────────────────────────────────────────────

export async function crearOpcionPg(input: {
  clinicaId: string | null;
  categoria: ConfigCategoria;
  valor: string;
  orden?: number;
}): Promise<ConfigOpcion> {
  const row = await runWithClienteDb(cli(), (trx) =>
    trx
      .insertInto("configuraciones_clinica")
      .values({
        cliente: cli(),
        resumen: `${input.categoria} · ${input.valor}${input.clinicaId ? ` · clinica` : ` · global`}`,
        categoria: input.categoria,
        valor: input.valor,
        activo: true,
        orden: input.orden ?? 0,
        clinica_id: input.clinicaId ?? null,
        created_at: new Date(),
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return toOpcion(toShim(row));
}

export async function actualizarOpcionPg(
  id: string,
  patch: Partial<{ valor: string; activo: boolean; orden: number }>,
): Promise<ConfigOpcion> {
  const set: Record<string, unknown> = {};
  if (patch.valor !== undefined) set.valor = patch.valor;
  if (patch.activo !== undefined) set.activo = patch.activo;
  if (patch.orden !== undefined) set.orden = patch.orden;
  const row = await runWithClienteDb(cli(), async (trx) => {
    if (Object.keys(set).length === 0) {
      // Paridad con Airtable .update(fields:{}) → devuelve el record sin cambios.
      return trx
        .selectFrom("configuraciones_clinica")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
    }
    return trx
      .updateTable("configuraciones_clinica")
      .set(set as any)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return toOpcion(toShim(row));
}

export async function eliminarOpcionPg(id: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx.deleteFrom("configuraciones_clinica").where("id", "=", id).execute(),
  );
}

export async function updateConfigClinicaRawPg(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const set = fieldsToColumns(fields);
  if (Object.keys(set).length === 0) return;
  await runWithClienteDb(cli(), (trx) =>
    trx.updateTable("configuraciones_clinica").set(set as any).where("id", "=", id).execute(),
  );
}

export async function createConfigClinicaRawPg(fields: Record<string, unknown>): Promise<void> {
  const values = fieldsToColumns(fields);
  await runWithClienteDb(cli(), (trx) =>
    trx
      .insertInto("configuraciones_clinica")
      .values({ cliente: cli(), ...values } as any)
      .execute(),
  );
}
