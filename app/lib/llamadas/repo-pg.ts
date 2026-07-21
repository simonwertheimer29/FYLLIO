// app/lib/llamadas/repo-pg.ts — FASE 2: dominio Vapi (Llamadas_Vapi) sobre Postgres.
//
// Espejo de repo.ts (Airtable) con paridad exacta. Las lecturas con
// filterByFormula se resuelven trayendo las filas del cliente (RLS via
// runWithClienteDb), mapeándolas a shims con NOMBRES de campo Airtable, y
// evaluando la MISMA fórmula que compone el repo con el evaluador COMPARTIDO
// (../db/airtable-formula) — cero SQL a medida por consulta. Los find/create/
// update targeted usan Kysely parametrizado. Todas devuelven el tipo Llamada
// via el mismo toLlamada() del repo.

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";
import type {
  EstadoLlamada,
  Llamada,
  ResultadoLlamada,
  TipoLlamada,
} from "./types";
import type { ListLlamadasFilters } from "./repo";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[llamadas-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

// Fila SQL → shim con nombres Airtable (los mismos que lee toLlamada / las
// fórmulas de los callers). Links → [id]; timestamptz → iso string (para que
// IS_AFTER({Iniciada_At},"...") compare bien); numeric → number (pg lo da como
// string). makeShim descarta null/undefined/"" igual que los shims de dominio.
function rowToShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      "Resumen": r.resumen,
      "Cita_Link": r.cita_id ? [r.cita_id] : undefined,
      "Paciente_Link": r.paciente_id ? [r.paciente_id] : undefined,
      "Tipo_Llamada": r.tipo_llamada,
      "Vapi_Call_Id": r.vapi_call_id,
      "Estado": r.estado,
      "Resultado": r.resultado,
      "Iniciada_At": r.iniciada_at ? iso(r.iniciada_at) : undefined,
      "Finalizada_At": r.finalizada_at ? iso(r.finalizada_at) : undefined,
      "Duracion_Segundos": r.duracion_segundos == null ? undefined : Number(r.duracion_segundos),
      "Notas": r.notas,
      "Transcripcion": r.transcripcion,
      "Coste_USD": r.coste_usd == null ? undefined : Number(r.coste_usd),
      "Created_At": r.created_at ? iso(r.created_at) : undefined,
      "Updated_At": r.updated_at ? iso(r.updated_at) : undefined,
    },
    iso(r.created_at),
  );
}

// Idéntico al toLlamada() de repo.ts — opera sobre { id, fields } (el shim lo es).
function toLlamada(rec: Shim): Llamada {
  const f = rec.fields ?? {};
  const citaLinks = (f["Cita_Link"] ?? []) as string[];
  const pacLinks = (f["Paciente_Link"] ?? []) as string[];
  return {
    id: rec.id,
    citaId: citaLinks[0] ?? null,
    pacienteId: pacLinks[0] ?? "",
    tipo: String(f["Tipo_Llamada"] ?? "confirmacion_cita") as TipoLlamada,
    vapiCallId: f["Vapi_Call_Id"] ? String(f["Vapi_Call_Id"]) : null,
    estado: String(f["Estado"] ?? "pendiente") as EstadoLlamada,
    resultado: String(f["Resultado"] ?? "sin_resultado") as ResultadoLlamada,
    iniciadaAt: String(f["Iniciada_At"] ?? ""),
    finalizadaAt: f["Finalizada_At"] ? String(f["Finalizada_At"]) : null,
    duracionSegundos:
      typeof f["Duracion_Segundos"] === "number" ? f["Duracion_Segundos"] : null,
    notas: f["Notas"] ? String(f["Notas"]) : null,
    transcripcion: f["Transcripcion"] ? String(f["Transcripcion"]) : null,
    costeUSD: typeof f["Coste_USD"] === "number" ? f["Coste_USD"] : null,
    createdAt: String(f["Created_At"] ?? ""),
    updatedAt: String(f["Updated_At"] ?? ""),
  };
}

// Molde mini-dominio: trae todas las filas del cliente, filtra con la fórmula
// Airtable (evaluador compartido), ordena y recorta en JS. Devuelve shims.
async function selectLlamadasRaw(opts: {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<Shim[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(`select * from llamadas_vapi order by created_at desc, id asc`)
      .execute(trx);
    return r.rows as any[];
  });
  let recs = rows.map(rowToShim);
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.sort?.length) {
    const { field, direction } = opts.sort[0]!;
    const key = (x: Shim) => String(x.fields[field] ?? "");
    recs.sort((a, b) => (direction === "desc" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
  }
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}

export async function createLlamadaPg(input: {
  citaId?: string | null;
  pacienteId: string;
  tipo: TipoLlamada;
  vapiCallId?: string | null;
  estado?: EstadoLlamada;
  notas?: string;
}): Promise<Llamada> {
  const c = cli();
  const now = new Date();
  const row = await runWithClienteDb(c, (trx) =>
    trx
      .insertInto("llamadas_vapi")
      .values({
        cliente: c,
        resumen: `${input.tipo} · ${input.pacienteId.slice(-6)}`,
        paciente_id: input.pacienteId,
        cita_id: input.citaId ?? null,
        tipo_llamada: input.tipo,
        vapi_call_id: input.vapiCallId ?? null,
        // typecast: se inserta el valor; el CHECK de estado en 001 lo valida.
        estado: input.estado ?? "iniciada",
        resultado: "sin_resultado",
        iniciada_at: now,
        notas: input.notas ?? null,
        created_at: now,
        updated_at: now,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return toLlamada(rowToShim(row));
}

export async function updateLlamadaPg(
  id: string,
  patch: Partial<{
    estado: EstadoLlamada;
    resultado: ResultadoLlamada;
    finalizadaAt: string | null;
    duracionSegundos: number | null;
    notas: string;
    transcripcion: string;
    costeUSD: number;
    vapiCallId: string;
  }>,
): Promise<Llamada> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.estado !== undefined) set.estado = patch.estado;
  if (patch.resultado !== undefined) set.resultado = patch.resultado;
  // repo: Finalizada_At = patch.finalizadaAt ?? "" (Airtable "" limpia el campo).
  // En timestamptz "" es inválido → null/"" ⇒ NULL (limpiar); ISO ⇒ Date.
  if (patch.finalizadaAt !== undefined)
    set.finalizada_at = patch.finalizadaAt ? new Date(patch.finalizadaAt) : null;
  if (patch.duracionSegundos !== undefined) set.duracion_segundos = patch.duracionSegundos;
  if (patch.notas !== undefined) set.notas = patch.notas;
  if (patch.transcripcion !== undefined) set.transcripcion = patch.transcripcion;
  if (patch.costeUSD !== undefined) set.coste_usd = patch.costeUSD;
  if (patch.vapiCallId !== undefined) set.vapi_call_id = patch.vapiCallId;
  const row = await runWithClienteDb(cli(), (trx) =>
    trx
      .updateTable("llamadas_vapi")
      .set(set as any)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return toLlamada(rowToShim(row));
}

export async function getLlamadaPg(id: string): Promise<Llamada | null> {
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const r = await trx
        .selectFrom("llamadas_vapi")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return r ? toLlamada(rowToShim(r)) : null;
    });
  } catch {
    return null;
  }
}

export async function getLlamadaPorVapiCallIdPg(
  vapiCallId: string,
): Promise<Llamada | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx
      .selectFrom("llamadas_vapi")
      .selectAll()
      .where("vapi_call_id", "=", vapiCallId)
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .limit(1)
      .executeTakeFirst();
    return r ? toLlamada(rowToShim(r)) : null;
  });
}

export async function listLlamadasPg(
  f: ListLlamadasFilters = {},
): Promise<Llamada[]> {
  const partes: string[] = [];
  if (f.pacienteId)
    partes.push(`FIND("${f.pacienteId}", ARRAYJOIN({Paciente_Link}, ","))`);
  if (f.estado) partes.push(`{Estado}="${f.estado}"`);
  if (f.resultado) partes.push(`{Resultado}="${f.resultado}"`);
  if (f.desde) partes.push(`IS_AFTER({Iniciada_At}, "${f.desde}")`);
  if (f.hasta) partes.push(`IS_BEFORE({Iniciada_At}, "${f.hasta}")`);
  const filterByFormula =
    partes.length === 0
      ? undefined
      : partes.length === 1
        ? partes[0]
        : `AND(${partes.join(", ")})`;

  try {
    const recs = await selectLlamadasRaw({
      filterByFormula,
      sort: [{ field: "Iniciada_At", direction: "desc" }],
    });
    const limit = f.limit ?? 50;
    return recs.slice(0, limit).map(toLlamada);
  } catch (err) {
    console.error("[llamadas listLlamadas pg]", err);
    return [];
  }
}

/** Cooldown 24h: ¿se llamó al paciente por IA en últimas 24h? */
export async function pacienteLlamadoUltimas24hPg(
  pacienteId: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const partes = [
    `FIND("${pacienteId}", ARRAYJOIN({Paciente_Link}, ","))`,
    `IS_AFTER({Iniciada_At}, "${desde}")`,
    `OR({Estado}="iniciada", {Estado}="en_curso", {Estado}="completada")`,
  ];
  try {
    const recs = await selectLlamadasRaw({
      filterByFormula: `AND(${partes.join(", ")})`,
      maxRecords: 1,
    });
    return recs.length > 0;
  } catch (err) {
    console.error("[llamadas pacienteLlamadoUltimas24h pg]", err);
    return false;
  }
}

/** Cuenta llamadas iniciadas hoy para un set de pacientes. */
export async function contarLlamadasHoyPorPacientePg(
  pacienteIds: string[],
): Promise<number> {
  if (pacienteIds.length === 0) return 0;
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const partes = [
    pacienteIds
      .map((p) => `FIND("${p}", ARRAYJOIN({Paciente_Link}, ","))`)
      .join(", "),
    `IS_AFTER({Iniciada_At}, "${inicioHoy.toISOString()}")`,
  ];
  const formula = `AND(OR(${partes[0]}), ${partes[1]})`;
  try {
    const recs = await selectLlamadasRaw({ filterByFormula: formula });
    return recs.length;
  } catch (err) {
    console.error("[llamadas contarLlamadasHoyPorPaciente pg]", err);
    return 0;
  }
}

/** Cuenta todas las llamadas iniciadas hoy. */
export async function contarLlamadasHoyPg(): Promise<number> {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  try {
    const recs = await selectLlamadasRaw({
      filterByFormula: `IS_AFTER({Iniciada_At}, "${inicioHoy.toISOString()}")`,
    });
    return recs.length;
  } catch (err) {
    console.error("[llamadas contarLlamadasHoy pg]", err);
    return 0;
  }
}

/** Tasa de fallidas en última hora — salvaguarda de pausa automática. */
export async function tasaFallidasUltimaHoraPg(): Promise<{
  total: number;
  fallidas: number;
  pct: number;
}> {
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  try {
    const recs = await selectLlamadasRaw({
      filterByFormula: `IS_AFTER({Iniciada_At}, "${desde}")`,
    });
    const total = recs.length;
    const fallidas = recs.filter((r) => r.fields["Estado"] === "fallida").length;
    const pct = total > 0 ? Math.round((fallidas / total) * 100) : 0;
    return { total, fallidas, pct };
  } catch (err) {
    console.error("[llamadas tasaFallidasUltimaHora pg]", err);
    return { total: 0, fallidas: 0, pct: 0 };
  }
}
