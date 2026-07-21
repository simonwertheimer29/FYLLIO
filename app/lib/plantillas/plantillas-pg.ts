// app/lib/plantillas/plantillas-pg.ts — FASE 2: dominio Plantillas_Mensaje sobre Postgres.
//
// Espejo Postgres de las funciones de plantillas.ts que tocan base(). Dos
// familias de consumidores comparten la MISMA tabla `plantillas_mensaje`:
//   · panel admin (categoria): listPlantillas / getPlantillaById / createPlantilla
//     / updatePlantilla → devuelven el tipo `Plantilla` (via rowToPlantilla, espejo
//     exacto de toPlantilla). Ahí `clinicaId` sale directo de `clinica_id`.
//   · CRUD de plantillas de presupuestos (tipo/clinica): selectPlantillasMensajeRaw
//     / find / create / update / destroy → devuelven SHIMS con NOMBRES de campo
//     Airtable, y el `filterByFormula` del caller se evalúa con el evaluador
//     COMPARTIDO (../db/airtable-formula). Cero SQL a medida por consulta.
//
// Mapeo NO obvio (documentado en el reporte): en Airtable `Clinica` es texto
// (nombre de la clínica o el bucket global "Todas") y `Clinica_Link` un link → id.
// En PG hay UNA sola columna `clinica_id` (FK a clinicas, nullable): global ⇒
// clinica_id NULL ⇒ Clinica="Todas". El NOMBRE se resuelve con LEFT JOIN a
// clinicas (idéntico a presupuestos/pg.ts); en escritura, el nombre se resuelve
// a id (o NULL si no existe / es "Todas"). `Tipo`/`Categoria` son TEXT sin CHECK
// en 001 → el typecast de Airtable es no-op: se inserta el valor tal cual.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";
import { extractVariables, type Plantilla, type PlantillaCategoria } from "./plantillas";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[plantillas-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

// ─── Mapeo fila → tipo Plantilla (panel admin, categoria) ──────────────────
// Espejo EXACTO de toPlantilla() de plantillas.ts, leyendo columnas PG en vez
// de campos Airtable. clinicaId = clinica_id (ambos son el id de la clínica).
function rowToPlantilla(r: any): Plantilla {
  const varsRaw = String(r.variables_detectadas ?? "");
  return {
    id: r.id,
    nombre: String(r.nombre ?? ""),
    categoria: String(r.categoria ?? "lead_seguimiento") as PlantillaCategoria,
    contenido: String(r.contenido ?? ""),
    variablesDetectadas: varsRaw
      ? varsRaw.split(",").map((v) => v.trim()).filter(Boolean)
      : [],
    clinicaId: r.clinica_id ?? null,
    activa: r.activa == null ? true : Boolean(r.activa),
    createdAt: iso(r.created_at),
  };
}

// ─── Mapeo fila (+ join clinicas) → shim con NOMBRES Airtable (CRUD presup.) ──
function rowToShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "Nombre": r.nombre,
      "Tipo": r.tipo,
      "Categoria": r.categoria,
      "Contenido": r.contenido,
      "Variables_Detectadas": r.variables_detectadas,
      "Doctor": r.doctor,
      "Tratamiento": r.tratamiento,
      // Clinica es texto en Airtable (nombre o "Todas"); lo reconstruimos del
      // JOIN — clinica_id NULL ⇒ sin match ⇒ "Todas" (bucket global).
      "Clinica": r._cli_nombre ?? "Todas",
      // Clinica_Link es el link → [id]; ausente si es global.
      "Clinica_Link": r.clinica_id ? [r.clinica_id] : undefined,
      "Activa": r.activa, // boolean — makeShim NO descarta false
      "Fecha_creacion": r.created_at ? iso(r.created_at) : undefined,
    },
    iso(r.created_at),
  );
}

const PLANT_SELECT = `
  select pm.*, cl.nombre as _cli_nombre
  from plantillas_mensaje pm
  left join clinicas cl on cl.cliente = pm.cliente and cl.id = pm.clinica_id`;

// Airtable field → columna PG (para writes del CRUD raw). Clinica se resuelve
// aparte (nombre → id); Fecha_creacion → created_at.
const RAW_COL: Record<string, string> = {
  Nombre: "nombre",
  Tipo: "tipo",
  Categoria: "categoria",
  Contenido: "contenido",
  Variables_Detectadas: "variables_detectadas",
  Doctor: "doctor",
  Tratamiento: "tratamiento",
  Activa: "activa",
};

async function resolveClinicaId(trx: any, nombre: string | null): Promise<string | null> {
  if (!nombre) return null;
  const c = await trx.selectFrom("clinicas").select("id").where("nombre", "=", nombre).executeTakeFirst();
  return c?.id ?? null;
}

// ─── Panel admin (categoria) ───────────────────────────────────────────────

export async function listPlantillasPg(): Promise<Plantilla[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx
      .selectFrom("plantillas_mensaje")
      .selectAll()
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(rowToPlantilla);
  });
}

export async function getPlantillaByIdPg(id: string): Promise<Plantilla | null> {
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const r = await trx.selectFrom("plantillas_mensaje").selectAll().where("id", "=", id).executeTakeFirst();
      return r ? rowToPlantilla(r) : null;
    });
  } catch {
    return null;
  }
}

export async function createPlantillaPg(input: {
  nombre: string;
  categoria: PlantillaCategoria;
  contenido: string;
  clinicaId: string | null;
  tipo?: string;
}): Promise<Plantilla> {
  const row = await runWithClienteDb(cli(), async (trx) =>
    trx
      .insertInto("plantillas_mensaje")
      .values({
        cliente: cli(),
        nombre: input.nombre,
        tipo: input.tipo ?? "Recordatorio",
        categoria: input.categoria,
        contenido: input.contenido,
        variables_detectadas: extractVariables(input.contenido).join(", "),
        activa: true,
        clinica_id: input.clinicaId ?? null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return rowToPlantilla(row);
}

export async function updatePlantillaPg(
  id: string,
  patch: Partial<{ nombre: string; categoria: PlantillaCategoria; contenido: string; activa: boolean }>,
): Promise<Plantilla> {
  const set: Record<string, unknown> = {};
  if (patch.nombre !== undefined) set.nombre = patch.nombre;
  if (patch.categoria !== undefined) set.categoria = patch.categoria;
  if (patch.contenido !== undefined) {
    set.contenido = patch.contenido;
    set.variables_detectadas = extractVariables(patch.contenido).join(", ");
  }
  if (patch.activa !== undefined) set.activa = patch.activa;
  const row = await runWithClienteDb(cli(), async (trx) =>
    trx
      .updateTable("plantillas_mensaje")
      .set(set as any)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return rowToPlantilla(row);
}

// ─── CRUD de plantillas de presupuestos (raw, nombres Airtable) ─────────────

export async function selectPlantillasMensajeRawPg(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
} = {}): Promise<any[]> {
  let recs = await runWithClienteDb(cli(), async (trx) => {
    const r: any = await sql.raw(`${PLANT_SELECT} order by pm.created_at asc, pm.id asc`).execute(trx);
    return (r.rows as any[]).map(rowToShim);
  });
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.sort?.length) {
    const sorts = opts.sort;
    recs.sort((a, b) => {
      for (const { field, direction } of sorts) {
        const av = String(a.fields[field] ?? "");
        const bv = String(b.fields[field] ?? "");
        const c = direction === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
        if (c !== 0) return c;
      }
      return 0;
    });
  }
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}

export async function findPlantillaMensajeRawPg(id: string): Promise<any> {
  // Paridad: base().find(id) LANZA si no existe (la ruta lo envuelve en catch→null).
  const recs = await selectPlantillasMensajeRawPg({ filterByFormula: `RECORD_ID()='${id}'`, maxRecords: 1 });
  const r = recs[0];
  if (!r) throw new Error(`plantilla no encontrada: ${id}`);
  return r;
}

export async function createPlantillaMensajeRawPg(fields: Record<string, unknown>): Promise<any> {
  const row = await runWithClienteDb(cli(), async (trx) => {
    const clinica_id = await resolveClinicaId(trx, fields["Clinica"] == null ? null : String(fields["Clinica"]));
    const values: Record<string, unknown> = {
      cliente: cli(),
      nombre: fields["Nombre"] ?? null,
      tipo: fields["Tipo"] ?? null,
      categoria: fields["Categoria"] ?? null,
      contenido: fields["Contenido"] ?? null,
      variables_detectadas: fields["Variables_Detectadas"] ?? null,
      doctor: fields["Doctor"] ?? null,
      tratamiento: fields["Tratamiento"] ?? null,
      activa: fields["Activa"] ?? null,
      clinica_id,
    };
    if (fields["Fecha_creacion"]) values.created_at = new Date(String(fields["Fecha_creacion"]));
    return trx.insertInto("plantillas_mensaje").values(values as any).returningAll().executeTakeFirstOrThrow();
  });
  // Releemos con join para devolver el shim (Clinica = nombre) igual que Airtable.
  return findPlantillaMensajeRawPg(row.id);
}

export async function updatePlantillaMensajeRawPg(id: string, fields: Record<string, unknown>): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const set: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(RAW_COL)) {
      if (fields[k] !== undefined) set[col] = fields[k];
    }
    if (fields["Clinica"] !== undefined) {
      set.clinica_id = await resolveClinicaId(trx, fields["Clinica"] == null ? null : String(fields["Clinica"]));
    }
    if (Object.keys(set).length === 0) return;
    await trx.updateTable("plantillas_mensaje").set(set as any).where("id", "=", id).execute();
  });
}

export async function destroyPlantillaMensajeRawPg(id: string): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    await trx.deleteFrom("plantillas_mensaje").where("id", "=", id).execute();
  });
}
