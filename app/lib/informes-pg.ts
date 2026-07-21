// app/lib/informes-pg.ts — FASE 2: dominio Informes (Informes_Guardados) sobre Postgres.
//
// Espejo passthrough de app/lib/informes.ts. Mismo patrón mini-dominio que
// notificaciones-pg / presupuestos-pg: se traen las filas del cliente (RLS via
// runWithClienteDb), se mapean a shims con NOMBRES de campo Airtable, y el
// `filterByFormula` que compone el caller se evalúa con el evaluador COMPARTIDO
// (./db/airtable-formula). Cero SQL a medida por consulta.
//
// Los NOMBRES de campo Airtable de esta tabla son snake_case en minúscula
// (tipo, clinica, periodo, titulo, contenido_json, texto_narrativo, generado_en,
// generado_por) — así los escriben/leen los callers (grep selectInformesRaw…).
//
// Único mapeo NO trivial — `clinica`:
//   · En Airtable `clinica` es texto libre: el NOMBRE de la clínica, o el bucket
//     global ("todas" en Presupuestos, "Todas" en No-Shows).
//   · En Postgres es `clinica_id` (FK a clinicas; null = bucket global) — D8
//     "los repos traducen". Igual que Objetivos en presupuestos/pg.ts:
//       READ  → JOIN clinicas → nombre.   clinica_id null ⇒ se reconstruye el
//               sentinel global ("Todas" para tipo noshow*, "todas" para el resto),
//               de modo que el `{clinica}='todas'` / `{clinica}='Todas'` del caller
//               siga resolviendo (paridad con Airtable).
//       WRITE → nombre → clinicas.id.   nombre sin match (incl. "todas"/"Todas")
//               ⇒ clinica_id null.
//   La distinción de casing entre "todas" y "Todas" no es recuperable desde un
//   clinica_id null; se reconstruye por `tipo`, que es la convención de los ÚNICOS
//   escritores (Presupuestos vs No-Shows), así que todo caller real round-trip-ea.

import { runWithClienteDb } from "./db/context";
import { currentCliente, type Cliente } from "./airtable";
import { evalFormula, makeShim, type Shim } from "./db/airtable-formula";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[informes-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

const SELECT = `
  select ig.*, cl.nombre as _cli_nombre
  from informes_guardados ig
  left join clinicas cl on cl.cliente = ig.cliente and cl.id = ig.clinica_id`;

function clinicaDeFila(r: any): string {
  if (r.clinica_id != null && r._cli_nombre) return String(r._cli_nombre);
  // clinica_id null = bucket global. Reconstruye el sentinel textual del escritor.
  return String(r.tipo ?? "").startsWith("noshow") ? "Todas" : "todas";
}

function toShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "tipo": r.tipo,
      "clinica": clinicaDeFila(r),
      "periodo": r.periodo,
      "titulo": r.titulo,
      "contenido_json": r.contenido_json,
      "texto_narrativo": r.texto_narrativo,
      "generado_en": r.generado_en ? iso(r.generado_en) : undefined,
      "generado_por": r.generado_por,
    },
    iso(r.created_at),
  );
}

async function allShims(trx: any): Promise<Shim[]> {
  const { sql } = await import("kysely");
  const r: any = await sql.raw(`${SELECT} order by ig.created_at desc, ig.id asc`).execute(trx);
  return (r.rows as any[]).map(toShim);
}

// ─── Lectura ────────────────────────────────────────────────────────────
export async function selectInformesRawPg(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  let recs = await runWithClienteDb(cli(), (trx) => allShims(trx));
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.sort?.length) {
    const { field, direction } = opts.sort[0]!;
    const key = (x: Shim) => String(x.fields[field] ?? "");
    recs.sort((a, b) => (direction === "desc" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
  }
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}

// ─── Escritura ──────────────────────────────────────────────────────────
// Nombre de campo Airtable → columna. `clinica` y `generado_en` se tratan aparte.
const COL: Record<string, string> = {
  tipo: "tipo",
  periodo: "periodo",
  titulo: "titulo",
  contenido_json: "contenido_json",
  texto_narrativo: "texto_narrativo",
  generado_por: "generado_por",
};

function buildSet(fields: Record<string, unknown>): {
  set: Record<string, unknown>;
  clinicaProvided: boolean;
  clinicaNombre?: string;
} {
  const set: Record<string, unknown> = {};
  let clinicaProvided = false;
  let clinicaNombre: string | undefined;
  for (const [k, v] of Object.entries(fields)) {
    if (k === "clinica") {
      clinicaProvided = true;
      clinicaNombre = v == null ? "" : String(v);
      continue;
    }
    if (k === "generado_en") {
      set.generado_en = v ? new Date(String(v)) : null;
      continue;
    }
    const col = COL[k];
    if (!col) continue;
    set[col] = v === "" ? null : v;
  }
  return { set, clinicaProvided, clinicaNombre };
}

async function clinicaIdDe(trx: any, nombre?: string): Promise<string | null> {
  if (!nombre) return null; // "" / undefined / "todas" / "Todas" no matchean → null (bucket global)
  const c = await trx.selectFrom("clinicas").select("id").where("nombre", "=", nombre).executeTakeFirst();
  return c?.id ?? null;
}

// Paridad exacta con Airtable: create([{fields}]) devuelve un ARRAY de records.
export async function createInformeRawPg(fields: Record<string, unknown>): Promise<any[]> {
  const { set, clinicaNombre } = buildSet(fields);
  return runWithClienteDb(cli(), async (trx) => {
    const clinica_id = await clinicaIdDe(trx, clinicaNombre);
    const row = await trx
      .insertInto("informes_guardados")
      .values({ cliente: cli(), clinica_id, ...set } as any)
      .returning("id")
      .executeTakeFirstOrThrow();
    const shims = await allShims(trx);
    return shims.filter((s) => s.id === (row as any).id); // [shim] — mismo shape que Airtable
  });
}

// Paridad exacta con Airtable: update(id, fields) devuelve el record (no array).
export async function updateInformeRawPg(id: string, fields: Record<string, unknown>): Promise<any> {
  const { set, clinicaProvided, clinicaNombre } = buildSet(fields);
  return runWithClienteDb(cli(), async (trx) => {
    if (clinicaProvided) (set as any).clinica_id = await clinicaIdDe(trx, clinicaNombre);
    if (Object.keys(set).length > 0) {
      await trx.updateTable("informes_guardados").set(set as any).where("id", "=", id).execute();
    }
    const shims = await allShims(trx);
    return shims.find((s) => s.id === id);
  });
}
