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
  if (usaPostgres("alertas")) {
    const pg = await import("./historial-pg");
    return pg.listHistorialPg(limit);
  }
  const recs = await fetchAll(base(TABLES.alertasEnviadas).select({}));
  const all = recs.map(toAlerta);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.slice(0, limit);
}

/** Última alerta (no-error) enviada para (clinicaId, tipo). */
export async function lastAlertFor(clinicaId: string, tipo: TipoAlerta): Promise<AlertaEnviada | null> {
  if (usaPostgres("alertas")) {
    const pg = await import("./historial-pg");
    return pg.lastAlertForPg(clinicaId, tipo);
  }
  const recs = await fetchAll(base(TABLES.alertasEnviadas).select({}));
  const match = recs
    .map(toAlerta)
    .filter((a) => a.clinicaId === clinicaId && a.tipo === tipo && !a.error)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return match[0] ?? null;
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
  if (usaPostgres("alertas")) {
    const pg = await import("./historial-pg");
    return pg.recordAlertPg(input);
  }
  // Sprint 14b Bloque 3 hotfix — typecast:true para que Airtable
  // extienda el singleSelect Tipo_Alerta cuando lleguen los nuevos
  // valores (cobro_vence_3d, cobro_vencido_7d, pendiente_alto_estancado).
  // Mismo workaround que TipoPago en Sprint 14a Bloque 6.
  const created = (
    await (base(TABLES.alertasEnviadas) as any).create(
      [
        {
          fields: {
            Clinica: [input.clinicaId],
            Tipo_Alerta: input.tipo,
            Admin_Origen: [input.adminId],
            Coordinadora_Destino: [input.coordinadoraId],
            Mensaje: input.mensaje,
            Error: input.error,
          },
        },
      ],
      { typecast: true },
    )
  )[0]!;
  return toAlerta(created);
}

// FASE 1 migración — alta genérica de alerta de coordinación (usada por
// vapi, motor de reglas, llamadas IA y no-shows) + lectura filtrada.
export async function createAlertaCoordinacionRaw(fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("alertas")) {
    const pg = await import("./historial-pg");
    return pg.createAlertaCoordinacionRawPg(fields);
  }
  await base(TABLES.alertasEnviadas).create([{ fields }] as any, { typecast: true } as any);
}
export async function selectAlertasEnviadasRaw(opts: {
  filterByFormula?: string;
  maxRecords?: number;
}): Promise<any[]> {
  if (usaPostgres("alertas")) {
    const pg = await import("./historial-pg");
    return pg.selectAlertasEnviadasRawPg(opts);
  }
  return fetchAll(base(TABLES.alertasEnviadas).select(opts as any));
}
