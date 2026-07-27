// app/lib/llamadas/repo.ts
//
// Sprint 17 Bloque 2/3 — repo Airtable para Llamadas_Vapi.

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
  const pg = await import("./repo-pg");
  return pg.createLlamadaPg(input);
  
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
  const pg = await import("./repo-pg");
  return pg.updateLlamadaPg(id, patch);
  
}

export async function getLlamada(id: string): Promise<Llamada | null> {
  const pg = await import("./repo-pg");
  return pg.getLlamadaPg(id);
  
}

export async function getLlamadaPorVapiCallId(
  vapiCallId: string,
): Promise<Llamada | null> {
  const pg = await import("./repo-pg");
  return pg.getLlamadaPorVapiCallIdPg(vapiCallId);
  
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
  const pg = await import("./repo-pg");
  return pg.listLlamadasPg(f);
  
}

/** Cooldown 24h: ¿se llamó al paciente por IA en últimas 24h? */
export async function pacienteLlamadoUltimas24h(
  pacienteId: string,
): Promise<boolean> {
  const pg = await import("./repo-pg");
  return pg.pacienteLlamadoUltimas24hPg(pacienteId);
  
}

/** Cuenta llamadas iniciadas hoy en una clínica. Para validar el límite
 *  por clínica configurable. La join clinica→llamadas se hace via
 *  Paciente_Link → Pacientes.Clínica; aquí mantenemos simple y pasamos
 *  un set de pacienteIds que el caller resuelve. */
export async function contarLlamadasHoyPorPaciente(
  pacienteIds: string[],
): Promise<number> {
  const pg = await import("./repo-pg");
  return pg.contarLlamadasHoyPorPacientePg(pacienteIds);
  
}

/** Cuenta todas las llamadas iniciadas hoy. Aproximación al límite
 *  por clínica (en V1 asumimos una clínica = un tenant de Fyllio;
 *  cuando crezcamos se filtrará por clinicaId via join Paciente_Link). */
export async function contarLlamadasHoy(): Promise<number> {
  const pg = await import("./repo-pg");
  return pg.contarLlamadasHoyPg();
  
}

/** Tasa de fallidas en última hora — usado por la salvaguarda
 *  "pausa automática" del Bloque 9. */
export async function tasaFallidasUltimaHora(): Promise<{
  total: number;
  fallidas: number;
  pct: number;
}> {
  const pg = await import("./repo-pg");
  return pg.tasaFallidasUltimaHoraPg();
  
}
