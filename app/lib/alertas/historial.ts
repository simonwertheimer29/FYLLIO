// app/lib/alertas/historial.ts
// Sprint 8 D.7 — acceso a Alertas_Enviadas para cooldown + log.

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
  /** La foto del momento del envío (011/012). `null` en las anteriores al
   *  2026-08-01: no se inventa una foto que no se tomó. */
  nAlEnviar: number | null;
  importeAlEnviar: number | null;
  /** A quién se le avisó ENTONCES — no se resuelve del id al leer. */
  coordinadoraNombre: string | null;
};

const COOLDOWN_MS = 2 * 60 * 60 * 1000;

// El mapper de la era Airtable vivía aquí con CERO consumidores: el único que
// existe es `shimToAlerta` en historial-pg. Retirado al pasar por esta zona en
// vez de "mantenerlo" añadiéndole los campos nuevos.

export async function listHistorial(limit = 50): Promise<AlertaEnviada[]> {
  const pg = await import("./historial-pg");
  return pg.listHistorialPg(limit);
  
}

/** Última alerta (no-error) enviada para (clinicaId, tipo). */
export async function lastAlertFor(clinicaId: string, tipo: TipoAlerta): Promise<AlertaEnviada | null> {
  const pg = await import("./historial-pg");
  return pg.lastAlertForPg(clinicaId, tipo);
  
}

/** TODAS las últimas alertas de una vez, por `clinicaId:tipo`. Lo que la ruta
 *  hacía con 8 llamadas EN SERIE, cada una leyendo la tabla entera. */
export async function ultimasAlertasPorClinicaTipo(): Promise<Map<string, AlertaEnviada>> {
  const pg = await import("./historial-pg");
  return pg.ultimasAlertasPorClinicaTipoPg();
}

/** El cooldown, en un solo sitio: lo usan la ruta (para pintar) y el POST
 *  (para bloquear). Antes el cliente lo reconstruía restando un `2*60*60*1000`
 *  escrito a mano — si el servidor cambiaba la ventana, la hora que se mostraba
 *  mentía en silencio. */
export const COOLDOWN_ALERTA_MS = COOLDOWN_MS;

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
  coordinadoraNombre?: string | null;
  mensaje: string;
  error: boolean;
  /** Cuántos casos había y cuánto dinero, al enviar. Es lo que después permite
   *  responder "¿sirvió el aviso?". */
  nAlEnviar?: number | null;
  importeAlEnviar?: number | null;
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
