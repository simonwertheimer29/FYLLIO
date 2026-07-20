// app/lib/presupuestos/notificaciones.ts
// Helper fire-and-forget para crear notificaciones in-app.

import { base, TABLES } from "../airtable";
import type { TipoNotificacion } from "./types";

export async function crearNotificacion(args: {
  usuario?: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link?: string;
}): Promise<void> {
  try {
    await (base(TABLES.notificaciones as any).create as any)({
      Usuario: args.usuario ?? "todos",
      Tipo: args.tipo,
      Titulo: args.titulo,
      Mensaje: args.mensaje,
      Link: args.link ?? "/presupuestos",
      Leida: false,
      Fecha_creacion: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[notificaciones] Error creando notificación:", err);
  }
}

// FASE 1 migración — lecturas/updates de Notificaciones para la ruta.
export async function selectNotificacionesRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<readonly any[]> {
  return base(TABLES.notificaciones as any).select(opts as any).all();
}
export async function updateNotificacionesBatchRaw(
  batch: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<void> {
  await base(TABLES.notificaciones as any).update(batch as any);
}
