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
