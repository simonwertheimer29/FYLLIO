// app/lib/presupuestos/notificaciones.ts
// Helper fire-and-forget para crear notificaciones in-app.

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";
import type { TipoNotificacion } from "./types";

export async function crearNotificacion(args: {
  usuario?: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link?: string;
}): Promise<void> {
  try {
    if (usaPostgres("notificaciones")) {
      const pg = await import("./notificaciones-pg");
      await pg.crearNotificacionPg(args);
      return;
    }
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
  if (usaPostgres("notificaciones")) {
    const pg = await import("./notificaciones-pg");
    return pg.selectNotificacionesRawPg(opts);
  }
  return base(TABLES.notificaciones as any).select(opts as any).all();
}
export async function updateNotificacionesBatchRaw(
  batch: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<void> {
  if (usaPostgres("notificaciones")) {
    const pg = await import("./notificaciones-pg");
    return pg.updateNotificacionesBatchRawPg(batch);
  }
  await base(TABLES.notificaciones as any).update(batch as any);
}
