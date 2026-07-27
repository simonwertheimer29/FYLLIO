// app/lib/alertas/historial.ts
// Sprint 8 D.7 — acceso a Alertas_Enviadas para cooldown + log.

import { base, TABLES, fetchAll } from "../airtable";
import { usaPostgres } from "../db/data-backend";
import type { TipoAlerta } from "./templates";

export type AlertaEnviada = {
  id: string;
  clinicaId: string | null;
  tipo: TipoAlerta | null;
  adminId: string | null;
  coordinadoraId: string | null;
  mensaje: string;
  error: boolean;
  createdAt: string;
};

const COOLDOWN_MS = 2 * 60 * 60 * 1000;

function toAlerta(rec: any): AlertaEnviada {
  const f = rec.fields ?? {};
  const clis = (f["Clinica"] ?? []) as string[];
  const admins = (f["Admin_Origen"] ?? []) as string[];
  const coords = (f["Coordinadora_Destino"] ?? []) as string[];
  return {
    id: rec.id,
    clinicaId: clis[0] ?? null,
    tipo: f["Tipo_Alerta"] ? (String(f["Tipo_Alerta"]) as TipoAlerta) : null,
    adminId: admins[0] ?? null,
    coordinadoraId: coords[0] ?? null,
    mensaje: String(f["Mensaje"] ?? ""),
    error: Boolean(f["Error"] ?? false),
    createdAt: String(rec._rawJson?.createdTime ?? rec.createdTime ?? ""),
  };
}

export async function listHistorial(limit = 50): Promise<AlertaEnviada[]> {
  const pg = await import("./historial-pg");
  return pg.listHistorialPg(limit);
  
}

/** Última alerta (no-error) enviada para (clinicaId, tipo). */
export async function lastAlertFor(clinicaId: string, tipo: TipoAlerta): Promise<AlertaEnviada | null> {
  const pg = await import("./historial-pg");
  return pg.lastAlertForPg(clinicaId, tipo);
  
}

/** `{ blocked: true, retryAfterMs }` si aún en cooldown. */
export async function checkCooldown(
  clinicaId: string,
  tipo: TipoAlerta
): Promise<{ blocked: false } | { blocked: true; retryAfterMs: number }> {
  const last = await lastAlertFor(clinicaId, tipo);
  if (!last) return { blocked: false };
  const elapsed = Date.now() - new Date(last.createdAt).getTime();
  if (elapsed >= COOLDOWN_MS) return { blocked: false };
  return { blocked: true, retryAfterMs: COOLDOWN_MS - elapsed };
}

export async function recordAlert(input: {
  clinicaId: string;
  tipo: TipoAlerta;
  adminId: string;
  coordinadoraId: string;
  mensaje: string;
  error: boolean;
}): Promise<AlertaEnviada> {
  const pg = await import("./historial-pg");
  return pg.recordAlertPg(input);
  
}

// FASE 1 migración — alta genérica de alerta de coordinación (usada por
// vapi, motor de reglas, llamadas IA y no-shows) + lectura filtrada.
export async function createAlertaCoordinacionRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./historial-pg");
  return pg.createAlertaCoordinacionRawPg(fields);
  
}
export async function selectAlertasEnviadasRaw(opts: {
  filterByFormula?: string;
  maxRecords?: number;
}): Promise<any[]> {
  const pg = await import("./historial-pg");
  return pg.selectAlertasEnviadasRawPg(opts);
  
}
