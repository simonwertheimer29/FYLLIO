// app/lib/automatizaciones/repo.ts
//
// Sprint 16b Bloque 1 — repo Airtable de Reglas / Acciones / Eventos.

import { base, fetchAll, TABLES } from "../airtable";
import type {
  Regla,
  AccionLog,
  EventoSistema,
  TriggerTipo,
  Condicion,
  Accion,
  ResultadoEjecucion,
  EventoTipo,
} from "./types";

// ─── Reglas ───────────────────────────────────────────────────────────

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as T[]) : [];
  } catch {
    return [];
  }
}

function toRegla(rec: any): Regla {
  const f = rec.fields ?? {};
  const clinicaLinks = (f["Clinica_Link"] ?? []) as string[];
  return {
    id: rec.id,
    clinicaId: clinicaLinks[0] ?? null,
    codigo: String(f["Codigo"] ?? ""),
    nombre: String(f["Nombre"] ?? ""),
    descripcion: String(f["Descripcion"] ?? ""),
    triggerTipo: String(f["Trigger_Tipo"] ?? "") as TriggerTipo,
    condiciones: parseJsonArray<Condicion>(f["Condiciones"]),
    acciones: parseJsonArray<Accion>(f["Acciones"]),
    activa: Boolean(f["Activa"] ?? false),
    vecesDisparada:
      typeof f["Veces_Disparada"] === "number" ? f["Veces_Disparada"] : 0,
    ultimaDisparada: f["Ultima_Disparada_At"]
      ? String(f["Ultima_Disparada_At"])
      : null,
    modoTest: Boolean(f["Modo_Test"] ?? false),
    pacienteTestId: f["Paciente_Test_Id"] ? String(f["Paciente_Test_Id"]) : null,
    createdAt: String(f["Created_At"] ?? ""),
    updatedAt: String(f["Updated_At"] ?? ""),
  };
}

export async function listReglas(): Promise<Regla[]> {
  // Defensivo: si la tabla no existe en prod (migración no corrida),
  // devolvemos lista vacía en lugar de tumbar al caller (cron, KPIs UI).
  // Logueamos para que aparezca en Vercel logs.
  try {
    const recs = await fetchAll(
      base(TABLES.reglasAutomatizacion).select({}),
    );
    return recs.map(toRegla);
  } catch (err) {
    console.error("[automatizaciones listReglas] tabla inaccesible:", err);
    return [];
  }
}

/** Devuelve reglas activas que coinciden con el trigger. Aplica
 *  override por clínica: si existe una regla con Clinica_Link =
 *  clinicaId Y misma Codigo, se prefiere sobre la global. */
export async function listReglasActivasParaTrigger(
  trigger: TriggerTipo,
  clinicaId: string | null,
): Promise<Regla[]> {
  const all = await listReglas();
  const matching = all.filter(
    (r) => r.activa && r.triggerTipo === trigger,
  );
  // Para cada Codigo, si hay override por la clínica del evento,
  // preferimos el override; si no, la global (clinicaId=null).
  const porCodigo = new Map<string, Regla>();
  for (const r of matching) {
    const aplica =
      r.clinicaId === null || (clinicaId && r.clinicaId === clinicaId);
    if (!aplica) continue;
    const prev = porCodigo.get(r.codigo);
    if (!prev) {
      porCodigo.set(r.codigo, r);
    } else {
      // Si la nueva es específica de la clínica y la previa es global,
      // sustituimos.
      if (r.clinicaId !== null && prev.clinicaId === null) {
        porCodigo.set(r.codigo, r);
      }
    }
  }
  return [...porCodigo.values()];
}

export async function getRegla(id: string): Promise<Regla | null> {
  try {
    const rec = await base(TABLES.reglasAutomatizacion).find(id);
    return toRegla(rec);
  } catch {
    return null;
  }
}

export async function createRegla(input: {
  codigo: string;
  nombre: string;
  descripcion: string;
  triggerTipo: TriggerTipo;
  condiciones: Condicion[];
  acciones: Accion[];
  clinicaId?: string | null;
  activa?: boolean;
  modoTest?: boolean;
  pacienteTestId?: string | null;
}): Promise<Regla> {
  const now = new Date().toISOString();
  const fields: Record<string, any> = {
    Resumen: input.nombre,
    Codigo: input.codigo,
    Nombre: input.nombre,
    Descripcion: input.descripcion,
    Trigger_Tipo: input.triggerTipo,
    Condiciones: JSON.stringify(input.condiciones),
    Acciones: JSON.stringify(input.acciones),
    Activa: input.activa ?? true,
    Modo_Test: input.modoTest ?? false,
    Veces_Disparada: 0,
    Created_At: now,
    Updated_At: now,
  };
  if (input.clinicaId) fields.Clinica_Link = [input.clinicaId];
  if (input.pacienteTestId) fields.Paciente_Test_Id = input.pacienteTestId;

  const created = (
    await base(TABLES.reglasAutomatizacion).create([{ fields }], {
      typecast: true,
    })
  )[0]!;
  return toRegla(created);
}

export async function updateRegla(
  id: string,
  patch: Partial<{
    activa: boolean;
    modoTest: boolean;
    pacienteTestId: string | null;
    condiciones: Condicion[];
    acciones: Accion[];
    nombre: string;
    descripcion: string;
  }>,
): Promise<Regla> {
  const fields: Record<string, any> = { Updated_At: new Date().toISOString() };
  if (patch.activa !== undefined) fields.Activa = patch.activa;
  if (patch.modoTest !== undefined) fields.Modo_Test = patch.modoTest;
  if (patch.pacienteTestId !== undefined)
    fields.Paciente_Test_Id = patch.pacienteTestId ?? "";
  if (patch.condiciones !== undefined)
    fields.Condiciones = JSON.stringify(patch.condiciones);
  if (patch.acciones !== undefined)
    fields.Acciones = JSON.stringify(patch.acciones);
  if (patch.nombre !== undefined) fields.Nombre = patch.nombre;
  if (patch.descripcion !== undefined) fields.Descripcion = patch.descripcion;

  const updated = (
    await base(TABLES.reglasAutomatizacion).update([{ id, fields }])
  )[0]!;
  return toRegla(updated);
}

export async function incrementarDisparos(reglaId: string): Promise<void> {
  const r = await getRegla(reglaId);
  if (!r) return;
  await base(TABLES.reglasAutomatizacion).update([
    {
      id: reglaId,
      fields: {
        Veces_Disparada: r.vecesDisparada + 1,
        Ultima_Disparada_At: new Date().toISOString(),
      },
    },
  ]);
}

// ─── Acciones (log) ───────────────────────────────────────────────────

export async function logAccion(input: {
  reglaId: string;
  pacienteId?: string | null;
  leadId?: string | null;
  presupuestoId?: string | null;
  resultado: ResultadoEjecucion;
  detalle: Record<string, unknown>;
}): Promise<void> {
  const fields: Record<string, any> = {
    Resumen: `${input.reglaId.slice(-6)} · ${input.resultado}`,
    Regla_Link: [input.reglaId],
    Resultado: input.resultado,
    Detalle: JSON.stringify(input.detalle),
    Ejecutada_At: new Date().toISOString(),
  };
  if (input.pacienteId) fields.Paciente_Link = [input.pacienteId];
  if (input.leadId) fields.Lead_Link = [input.leadId];
  if (input.presupuestoId) fields.Presupuesto_Link = [input.presupuestoId];
  await base(TABLES.accionesAutomatizacion).create([{ fields }], {
    typecast: true,
  });
}

export type AccionLogRow = AccionLog & {
  reglaCodigo?: string;
  reglaNombre?: string;
};

function toAccionLog(rec: any): AccionLog {
  const f = rec.fields ?? {};
  const reglaLinks = (f["Regla_Link"] ?? []) as string[];
  const pacLinks = (f["Paciente_Link"] ?? []) as string[];
  const leadLinks = (f["Lead_Link"] ?? []) as string[];
  const presLinks = (f["Presupuesto_Link"] ?? []) as string[];
  return {
    id: rec.id,
    reglaId: reglaLinks[0] ?? "",
    pacienteId: pacLinks[0] ?? null,
    leadId: leadLinks[0] ?? null,
    presupuestoId: presLinks[0] ?? null,
    resultado: String(f["Resultado"] ?? "error") as ResultadoEjecucion,
    detalle: String(f["Detalle"] ?? ""),
    ejecutadaAt: String(f["Ejecutada_At"] ?? ""),
  };
}

export async function listAcciones(
  filtros: { reglaId?: string; soloErrores?: boolean; limit?: number } = {},
): Promise<AccionLog[]> {
  const formulas: string[] = [];
  if (filtros.reglaId) {
    formulas.push(
      `FIND("${filtros.reglaId}", ARRAYJOIN({Regla_Link}, ","))`,
    );
  }
  if (filtros.soloErrores) {
    formulas.push(`{Resultado} = "error"`);
  }
  const filterByFormula =
    formulas.length === 0
      ? undefined
      : formulas.length === 1
        ? formulas[0]
        : `AND(${formulas.join(", ")})`;

  const recs = await fetchAll(
    base(TABLES.accionesAutomatizacion).select({
      ...(filterByFormula ? { filterByFormula } : {}),
      sort: [{ field: "Ejecutada_At", direction: "desc" }],
      pageSize: 100,
    }),
  );
  const limit = filtros.limit ?? 50;
  return recs.slice(0, limit).map(toAccionLog);
}

// ─── Eventos ──────────────────────────────────────────────────────────

export async function emitirEventoRow(input: {
  tipo: EventoTipo;
  entidadTipo: EventoSistema["entidadTipo"];
  entidadId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await base(TABLES.eventosSistema).create(
    [
      {
        fields: {
          Resumen: `${input.tipo} · ${input.entidadId.slice(-6)}`,
          Tipo: input.tipo,
          Entidad_Tipo: input.entidadTipo,
          Entidad_Id: input.entidadId,
          Payload: JSON.stringify(input.payload),
          Procesado: false,
          Created_At: new Date().toISOString(),
        },
      },
    ],
    { typecast: true },
  );
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — acceso restante a Eventos_Sistema y helper de dedup
// del cron (Acciones_Automatizacion), movidos aquí desde el cron.
// ─────────────────────────────────────────────────────────────────────

/** Eventos lead_creado sin procesar anteriores a `antesDeIso` (trigger
 *  lead_sin_gestionar_2h). Records crudos: el cron lee Payload/Entidad_Id. */
export async function listEventosLeadCreadoSinProcesarRaw(antesDeIso: string): Promise<any[]> {
  return fetchAll(
    base(TABLES.eventosSistema).select({
      filterByFormula: `AND({Tipo}="lead_creado", NOT({Procesado}), IS_BEFORE({Created_At}, "${antesDeIso}"))`,
      pageSize: 100,
    }),
  );
}

/** Marca un evento del sistema como procesado. */
export async function marcarEventoProcesado(eventoId: string): Promise<void> {
  await base(TABLES.eventosSistema).update([
    { id: eventoId, fields: { Procesado: true } },
  ]);
}

/**
 * Dedup del cron: ¿la regla ya disparó con success en los últimos N días
 * sobre este presupuesto/paciente? (movida desde el cron, paridad exacta).
 */
export async function yaDisparadaRecientemente(args: {
  reglaId: string;
  presupuestoId?: string;
  pacienteId?: string;
  dias: number;
}): Promise<boolean> {
  const desde = new Date(
    Date.now() - args.dias * 24 * 3600 * 1000,
  ).toISOString();
  const partes: string[] = [
    `FIND("${args.reglaId}", ARRAYJOIN({Regla_Link}, ","))`,
    `{Resultado}="success"`,
    `IS_AFTER({Ejecutada_At}, "${desde}")`,
  ];
  if (args.presupuestoId) {
    partes.push(
      `FIND("${args.presupuestoId}", ARRAYJOIN({Presupuesto_Link}, ","))`,
    );
  }
  if (args.pacienteId) {
    partes.push(
      `FIND("${args.pacienteId}", ARRAYJOIN({Paciente_Link}, ","))`,
    );
  }
  const recs = await fetchAll(
    base(TABLES.accionesAutomatizacion).select({
      filterByFormula: `AND(${partes.join(", ")})`,
      maxRecords: 1,
    }),
  );
  return recs.length > 0;
}
