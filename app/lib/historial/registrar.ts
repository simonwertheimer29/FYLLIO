// app/lib/historial/registrar.ts
// Utilidad interna para registrar acciones automáticas en Historial_Acciones.
// Fire-and-forget: nunca lanza, nunca bloquea el caller.
//
// Bloque 2 dashboard (2026-07-23): con el dominio presupuestos en Postgres,
// el historial se escribe en la tabla PG historial_acciones (antes iba
// SIEMPRE a Airtable, así que en DEMO/PG el historial no existía y la fecha
// de pérdida de un presupuesto era inderivable — decisión de Simon: la
// fecha de pérdida se deriva del cambio_estado→PERDIDO del historial).

import { base, TABLES } from "../airtable";
import type { TipoAccion } from "../presupuestos/types";
import { DateTime } from "luxon";
import { usaPostgres } from "../db/data-backend";

export async function registrarAccion(args: {
  presupuestoId: string;
  tipo: TipoAccion;
  descripcion: string;
  metadata?: Record<string, unknown>;
  registradoPor?: string;
  clinica?: string;
}): Promise<void> {
  const fecha = DateTime.now().setZone("Europe/Madrid").toISO() ?? new Date().toISOString();
  try {
    if (usaPostgres("presupuestos")) {
      const { runWithClienteDb } = await import("../db/context");
      const { currentCliente } = await import("../airtable");
      const cliente = currentCliente();
      if (!cliente) throw new Error("[historial] sin cliente en contexto (fail-closed)");
      await runWithClienteDb(cliente, (trx) =>
        trx
          .insertInto("historial_acciones")
          .values({
            cliente,
            presupuesto_id: args.presupuestoId,
            tipo: args.tipo,
            descripcion: args.descripcion,
            metadata: args.metadata ? JSON.stringify(args.metadata) : "",
            registrado_por: args.registradoPor ?? "",
            clinica_id: null,
            fecha: new Date(fecha),
          })
          .execute(),
      );
      return;
    }
    await base(TABLES.historialAcciones as any).create({
      presupuesto_id: args.presupuestoId,
      tipo: args.tipo,
      descripcion: args.descripcion,
      metadata: args.metadata ? JSON.stringify(args.metadata) : "",
      registrado_por: args.registradoPor ?? "",
      clinica: args.clinica ?? "",
      fecha,
    } as any);
  } catch (err) {
    console.error("[historial] registrarAccion error:", args.tipo, err);
    // nunca lanzar — el historial es secundario, no debe romper el flujo principal
  }
}

/**
 * Fecha de PÉRDIDA por presupuesto, derivada del historial real
 * (cambio_estado con estadoNuevo=PERDIDO; se toma el último). Decisión
 * 2026-07-23: no existe columna fecha_perdida — el historial ES el registro.
 * Honesto con los antiguos: un presupuesto perdido sin entrada de historial
 * simplemente no aparece en el mapa (sin fecha, sin mes, sin inventar).
 * Solo rama PG; en la rama Airtable congelada devuelve mapa vacío.
 */
export async function fechasPerdidaPorPresupuesto(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!usaPostgres("presupuestos")) return map;
  try {
    const { runWithClienteDb } = await import("../db/context");
    const { currentCliente } = await import("../airtable");
    const cliente = currentCliente();
    if (!cliente) throw new Error("[historial] sin cliente en contexto (fail-closed)");
    const rows = await runWithClienteDb(cliente, (trx) =>
      trx
        .selectFrom("historial_acciones")
        .select(["presupuesto_id", "fecha", "metadata"])
        .where("tipo", "=", "cambio_estado")
        .where("presupuesto_id", "is not", null)
        .execute(),
    );
    for (const r of rows) {
      if (!r.presupuesto_id || !r.fecha) continue;
      let estadoNuevo = "";
      try {
        estadoNuevo = String(JSON.parse(r.metadata ?? "{}")?.estadoNuevo ?? "");
      } catch {
        /* metadata ilegible → se ignora la fila */
      }
      if (estadoNuevo !== "PERDIDO") continue;
      const iso = r.fecha instanceof Date ? r.fecha.toISOString() : String(r.fecha);
      const prev = map.get(r.presupuesto_id);
      if (!prev || iso > prev) map.set(r.presupuesto_id, iso);
    }
  } catch (err) {
    console.error("[historial] fechasPerdidaPorPresupuesto:", err);
  }
  return map;
}

// FASE 1 migración — lecturas de Historial_Acciones para las rutas.
export async function selectHistorialRaw(opts: {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<readonly any[]> {
  return base(TABLES.historialAcciones as any).select(opts as any).all();
}
