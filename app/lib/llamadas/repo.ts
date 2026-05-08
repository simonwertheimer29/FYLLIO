// app/lib/llamadas/repo.ts
//
// Sprint 17 Bloque 2/3 — repo Airtable para Llamadas_Vapi.

import { base, fetchAll, TABLES } from "../airtable";
import type {
  EstadoLlamada,
  Llamada,
  ResultadoLlamada,
  TipoLlamada,
} from "./types";

function toLlamada(rec: any): Llamada {
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

export async function createLlamada(input: {
  citaId?: string | null;
  pacienteId: string;
  tipo: TipoLlamada;
  vapiCallId?: string | null;
  estado?: EstadoLlamada;
  notas?: string;
}): Promise<Llamada> {
  const now = new Date().toISOString();
  const fields: Record<string, any> = {
    Resumen: `${input.tipo} · ${input.pacienteId.slice(-6)}`,
    Paciente_Link: [input.pacienteId],
    Tipo_Llamada: input.tipo,
    Estado: input.estado ?? "iniciada",
    Resultado: "sin_resultado",
    Iniciada_At: now,
    Created_At: now,
    Updated_At: now,
  };
  if (input.citaId) fields.Cita_Link = [input.citaId];
  if (input.vapiCallId) fields.Vapi_Call_Id = input.vapiCallId;
  if (input.notas) fields.Notas = input.notas;
  const created = (
    await base(TABLES.llamadasVapi).create([{ fields }], { typecast: true })
  )[0]!;
  return toLlamada(created);
}

export async function updateLlamada(
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
  const fields: Record<string, any> = { Updated_At: new Date().toISOString() };
  if (patch.estado !== undefined) fields.Estado = patch.estado;
  if (patch.resultado !== undefined) fields.Resultado = patch.resultado;
  if (patch.finalizadaAt !== undefined)
    fields.Finalizada_At = patch.finalizadaAt ?? "";
  if (patch.duracionSegundos !== undefined)
    fields.Duracion_Segundos = patch.duracionSegundos;
  if (patch.notas !== undefined) fields.Notas = patch.notas;
  if (patch.transcripcion !== undefined)
    fields.Transcripcion = patch.transcripcion;
  if (patch.costeUSD !== undefined) fields.Coste_USD = patch.costeUSD;
  if (patch.vapiCallId !== undefined) fields.Vapi_Call_Id = patch.vapiCallId;
  const updated = (
    await base(TABLES.llamadasVapi).update([{ id, fields }], { typecast: true })
  )[0]!;
  return toLlamada(updated);
}

export async function getLlamada(id: string): Promise<Llamada | null> {
  try {
    const rec = await base(TABLES.llamadasVapi).find(id);
    return toLlamada(rec);
  } catch {
    return null;
  }
}

export async function getLlamadaPorVapiCallId(
  vapiCallId: string,
): Promise<Llamada | null> {
  const recs = await fetchAll(
    base(TABLES.llamadasVapi).select({
      filterByFormula: `{Vapi_Call_Id} = "${vapiCallId.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    }),
  );
  const r = recs[0];
  return r ? toLlamada(r) : null;
}

export type ListLlamadasFilters = {
  pacienteId?: string;
  estado?: EstadoLlamada;
  resultado?: ResultadoLlamada;
  desde?: string; // ISO
  hasta?: string;
  limit?: number;
};

export async function listLlamadas(
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
    const recs = await fetchAll(
      base(TABLES.llamadasVapi).select({
        ...(filterByFormula ? { filterByFormula } : {}),
        sort: [{ field: "Iniciada_At", direction: "desc" }],
        pageSize: 100,
      }),
    );
    const limit = f.limit ?? 50;
    return recs.slice(0, limit).map(toLlamada);
  } catch (err) {
    console.error("[llamadas listLlamadas]", err);
    return [];
  }
}

/** Cooldown 24h: ¿se llamó al paciente por IA en últimas 24h? */
export async function pacienteLlamadoUltimas24h(
  pacienteId: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const partes = [
    `FIND("${pacienteId}", ARRAYJOIN({Paciente_Link}, ","))`,
    `IS_AFTER({Iniciada_At}, "${desde}")`,
    `OR({Estado}="iniciada", {Estado}="en_curso", {Estado}="completada")`,
  ];
  try {
    const recs = await fetchAll(
      base(TABLES.llamadasVapi).select({
        filterByFormula: `AND(${partes.join(", ")})`,
        maxRecords: 1,
      }),
    );
    return recs.length > 0;
  } catch {
    return false;
  }
}

/** Cuenta llamadas iniciadas hoy en una clínica. Para validar el límite
 *  por clínica configurable. La join clinica→llamadas se hace via
 *  Paciente_Link → Pacientes.Clínica; aquí mantenemos simple y pasamos
 *  un set de pacienteIds que el caller resuelve. */
export async function contarLlamadasHoyPorPaciente(
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
    const recs = await fetchAll(
      base(TABLES.llamadasVapi).select({
        filterByFormula: formula,
        pageSize: 100,
      }),
    );
    return recs.length;
  } catch {
    return 0;
  }
}

/** Tasa de fallidas en última hora — usado por la salvaguarda
 *  "pausa automática" del Bloque 9. */
export async function tasaFallidasUltimaHora(): Promise<{
  total: number;
  fallidas: number;
  pct: number;
}> {
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  try {
    const recs = await fetchAll(
      base(TABLES.llamadasVapi).select({
        filterByFormula: `IS_AFTER({Iniciada_At}, "${desde}")`,
        pageSize: 100,
      }),
    );
    const total = recs.length;
    const fallidas = recs.filter((r: any) => r.fields["Estado"] === "fallida")
      .length;
    const pct = total > 0 ? Math.round((fallidas / total) * 100) : 0;
    return { total, fallidas, pct };
  } catch {
    return { total: 0, fallidas: 0, pct: 0 };
  }
}
