// app/lib/pagos.ts
//
// Sprint 13.1 Bloque 0 — helpers de la tabla Pagos_Paciente.
//
// Diseño:
//  - Cada Pago es un registro con Fecha_Pago real, Importe, Metodo y
//    Tipo. Soporta tandas, financiación y señales.
//  - Pacientes.Pagado se mantiene como CACHE total (Σ pagos del paciente)
//    para no romper código existente que lo lee directamente. Al
//    insertar un pago via crearPago(), también sumamos al campo
//    Pacientes.Pagado del paciente vinculado y restamos del Pendiente
//    si quedaba saldo.
//  - getFacturadoEnPeriodo() lee Pagos_Paciente directamente filtrando
//    por Fecha_Pago. Soporta filtro por clinica + soloOrigenLead.

import {
  listResumenFinancieroPorIds,
  sumPendientePorIds,
} from "./pacientes/pacientes";
import type { MetodoPago, TipoPago, Pago } from "./pagos-format";

// Sprint B — los tipos y helpers PUROS (MetodoPago, TipoPago, Pago, TIPOS_PAGO,
// METODOS_PAGO, formatTipo) viven ahora en pagos-format.ts (sin dependencia de
// Airtable) para no arrastrar la capa de datos al bundle cliente. Se re-exportan
// aquí para que todo el código de servidor los siga importando desde pagos.ts.
export { TIPOS_PAGO, METODOS_PAGO, formatTipo } from "./pagos-format";
export type { MetodoPago, TipoPago, Pago } from "./pagos-format";

function toPago(rec: any): Pago {
  const f = rec.fields ?? {};
  const links = (f["Paciente_Link"] ?? []) as string[];
  const usuarios = (f["Usuario_Creador"] ?? []) as string[];
  // Sprint 14a — preferimos Paciente_RecordId (texto plano rellenado por
  // codigo) sobre Paciente_Link[0]. Ambos coinciden por contrato; el
  // texto plano es el que permite filterByFormula directo.
  const pacienteId = String(f["Paciente_RecordId"] ?? "") || links[0] || "";
  return {
    id: rec.id,
    pacienteId,
    fechaPago: String(f["Fecha_Pago"] ?? "").slice(0, 10),
    importe: Number(f["Importe"] ?? 0),
    metodo: (String(f["Metodo"] ?? "Otro") as MetodoPago),
    tipo: (String(f["Tipo"] ?? "Liquidacion") as TipoPago),
    nota: f["Nota"] ? String(f["Nota"]) : null,
    createdAt: String(rec._rawJson?.createdTime ?? rec.createdTime ?? ""),
    usuarioCreadorId: usuarios[0] ?? null,
  };
}

// ─── Lectura ──────────────────────────────────────────────────────────

export async function getPagosByPaciente(pacienteId: string): Promise<Pago[]> {
  const pg = await import("./pagos-pg");
  return pg.getPagosByPacientePg(pacienteId);
  
}

/**
 * Total facturado en un periodo, opcionalmente filtrado por clinica
 * (nombre, ya que Pacientes.Clinica es link → leemos el nombre desde
 * Pacientes) y por origen lead (Pacientes con Lead_Origen != null).
 *
 * Implementacion: leemos Pagos_Paciente del periodo filtrando por
 * Fecha_Pago. Si soloOrigenLead o clinicaId, hacemos un cruce a
 * Pacientes para resolver pertenencia. Para volúmenes pequeños es OK;
 * en cuanto haya >5k pagos vale la pena cachear (Bloque 4.8).
 */
export async function getFacturadoEnPeriodo(args: {
  desde: Date;
  hasta: Date;
  /** Filtra a pacientes con Lead_Origen presente (origen lead). */
  soloOrigenLead?: boolean;
  /** Filtra a una clinica concreta (record id de Clinicas). */
  clinicaId?: string;
}): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  const pg = await import("./pagos-pg");
  return pg.getFacturadoEnPeriodoPg(args);
  
}

/**
 * Sprint 13.1.1 — facturado preciso filtrando Pagos_Paciente por una
 * lista concreta de pacientes (usado por el ranking de doctores).
 *
 * Por que existe: la version pro-rata (importe periodo × ratio
 * convertidos doctor/total) era una estimacion. R2b va a cruzar
 * contra contabilidad real desde semana 1 del piloto y cualquier
 * divergencia rompe confianza. Esta version suma los pagos reales
 * de los pacientes que el doctor convirtio.
 *
 * Sprint 14a — implementacion via filterByFormula directo sobre
 * Paciente_RecordId (texto plano rellenado por codigo). Sustituye al
 * workaround load-all+filter-JS del Sprint 13.1.1, que se introdujo
 * porque ARRAYJOIN({Paciente_Link}) devolvia el primary field
 * "PAT_NNN" en lugar de record IDs. Con Paciente_RecordId la formula
 * matchea limpio.
 *
 * Batching: filterByFormula tiene limite ~16k chars. Con
 * "{Paciente_RecordId}='recXXX'" (~40 chars por id) y wrapper OR(),
 * batches de 50 quedan muy lejos del limite. Cada batch se ejecuta en
 * paralelo (max 50 ids/batch × N batches concurrentes).
 *
 * Pendiente: suma Pacientes.Pendiente filtrada por pacienteIds
 * (no necesita rango de fecha — es saldo actual del paciente,
 * mantenido como cache por crearPago()).
 */
const BATCH_SIZE_PACIENTES = 50;

export async function getFacturadoPorPacientes(args: {
  pacienteIds: string[];
  desde: Date;
  hasta: Date;
}): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  const pg = await import("./pagos-pg");
  return pg.getFacturadoPorPacientesPg(args);
  
}

async function getPendienteSum(pacIds: string[]): Promise<number> {
  // FASE 1 migración: query + batching viven en el repo del dominio Pacientes.
  return sumPendientePorIds(pacIds);
}

// ─── Escritura ─────────────────────────────────────────────────────────

// MEJORAS 28 paso 2 (2026-07-27) — aquí vivía syncPacienteCache: recalculaba
// y reescribía las copias Pacientes.Pagado/Pendiente en cada pago, y cuando
// fallaba dejaba una entrada en Inconsistencias_Pagos para repararlas después.
// Las cuatro copias ya no existen (todo se deriva de pagos + presupuestos), así
// que la sincronización, su log de inconsistencias y su reconciliación mueren
// con ellas: no se puede desincronizar lo que no se duplica.

// El log de auditoría de pagos lo escribe el repo de Postgres
// (logAccionPagoPgIntern); aquí vivía su gemelo de Airtable, sin llamadores.


/**
 * Crea un Pago en Pagos_Paciente y sincroniza Pacientes.Pagado (cache)
 * recalculando desde Pagos_Paciente. Audita en Acciones_Pago.
 */
export async function crearPago(args: {
  pacienteId: string;
  importe: number;
  fechaPago?: string; // ISO YYYY-MM-DD; default = hoy
  metodo?: MetodoPago;
  tipo?: TipoPago;
  nota?: string;
  /** Sprint 14a — id de Usuario que registra el pago (auditoria real). */
  usuarioCreadorId?: string;
}): Promise<Pago> {
  const pg = await import("./pagos-pg");
  return pg.crearPagoPg(args);
  
}

/**
 * Sprint 14a Bloque 6 — actualiza un pago existente. Recalcula cache
 * desde Pagos_Paciente. Audita el cambio con importe antes/despues.
 */
export async function actualizarPago(
  pagoId: string,
  patch: Partial<{
    importe: number;
    fechaPago: string;
    metodo: MetodoPago;
    tipo: TipoPago;
    nota: string | null;
  }>,
  context: { usuarioId?: string | null } = {},
): Promise<Pago> {
  const pg = await import("./pagos-pg");
  return pg.actualizarPagoPg(pagoId, patch, context);
  
}

/**
 * Sprint 14a Bloque 6 — elimina un pago. Recalcula cache. Audita.
 */
export async function eliminarPago(
  pagoId: string,
  context: { usuarioId?: string | null } = {},
): Promise<void> {
  const pg = await import("./pagos-pg");
  return pg.eliminarPagoPg(pagoId, context);
  
}

// ─── Util fechas ─────────────────────────────────────────────────────

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — lectura consolidada de Pagos_Paciente para los
// consumidores externos (cola-cobros, kpis/cobros, copilot, alertas).
// Un método con periodo opcional sustituye 5 queries casi idénticas.
// ─────────────────────────────────────────────────────────────────────

export type PagoResumen = {
  pacienteRecordId: string;
  importe: number;
  metodo: string;
  tipo: string;
  /** ISO completo tal cual está en Airtable; el caller recorta si quiere. */
  fechaPago: string;
};

/**
 * Pagos con campos de resumen. Sin opts = all-time. Con bounds (ya
 * desplazados ±1 día por el caller, IS_AFTER/IS_BEFORE son exclusivos)
 * filtra por Fecha_Pago; un solo bound también vale (copilot).
 */
export async function listPagosResumen(opts: {
  desdeExclusivoIso?: string;
  hastaExclusivoIso?: string;
} = {}): Promise<PagoResumen[]> {
  const pg = await import("./pagos-pg");
  return pg.listPagosResumenPg(opts);
  
}
