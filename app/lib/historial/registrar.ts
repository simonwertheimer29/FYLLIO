// app/lib/historial/registrar.ts
// Utilidad interna para registrar acciones automáticas en Historial_Acciones.
// Fire-and-forget: nunca lanza, nunca bloquea el caller.

import { base, TABLES } from "../airtable";
import type { TipoAccion } from "../presupuestos/types";
import { DateTime } from "luxon";

export async function registrarAccion(args: {
  presupuestoId: string;
  tipo: TipoAccion;
  descripcion: string;
  metadata?: Record<string, unknown>;
  registradoPor?: string;
  clinica?: string;
}): Promise<void> {
  try {
    await base(TABLES.historialAcciones as any).create({
      presupuesto_id: args.presupuestoId,
      tipo: args.tipo,
      descripcion: args.descripcion,
      metadata: args.metadata ? JSON.stringify(args.metadata) : "",
      registrado_por: args.registradoPor ?? "",
      clinica: args.clinica ?? "",
      fecha: DateTime.now().setZone("Europe/Madrid").toISO() ?? new Date().toISOString(),
    } as any);
  } catch (err) {
    console.error("[historial] registrarAccion error:", args.tipo, err);
    // nunca lanzar — el historial es secundario, no debe romper el flujo principal
  }
}
