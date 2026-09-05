// app/lib/configuracion/historial.ts
//
// EL HISTORIAL DE CONFIGURACIÓN (plan maestro fase 0, MEJORAS 167, migración
// 038). Una fila por campo cambiado, escrita EN LA MISMA TRANSACCIÓN que el
// cambio: el historial no es telemetría, es el dato — sin él no hay «desde
// cuándo» (181), ni auditoría, ni rollback. Si no se puede anotar, no se
// guarda el cambio (§1).
//
// Los valores viajan como texto: un blob JSON entero cuando el campo es un
// blob (conocimiento, objetivos) — eso ES su historial de versiones.

import type { Transaction } from "kysely";
import type { DB } from "../db/types";
import type { Cliente } from "../cliente-contexto";

export type CambioConfiguracion = { campo: string; antes: unknown; despues: unknown };

const IGNORADOS = new Set(["id", "cliente", "actualizado_en", "created_at"]);

const aTexto = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
};

/** Qué cambió, campo a campo. Compara la forma canónica en texto: dos JSON
 *  equivalentes con distinto orden de claves cuentan como iguales solo si
 *  llegan ya normalizados (la ruta guarda el parse normalizado, no el crudo). */
export function diffConfiguracion(
  antes: Record<string, unknown> | null | undefined,
  despues: Record<string, unknown>,
): CambioConfiguracion[] {
  const cambios: CambioConfiguracion[] = [];
  const claves = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues)]);
  for (const campo of claves) {
    if (IGNORADOS.has(campo)) continue;
    if (!(campo in despues)) continue; // solo lo que la escritura tocó
    const a = aTexto(antes?.[campo]);
    const d = aTexto(despues[campo]);
    if (a !== d) cambios.push({ campo, antes: a, despues: d });
  }
  return cambios;
}

/** Inserta los cambios. Devuelve cuántos anotó. Dentro de la trx del caller. */
export async function registrarCambiosConfiguracion(
  trx: Transaction<DB>,
  args: {
    cliente: Cliente;
    clinicaId: string | null;
    tabla: string;
    cambios: CambioConfiguracion[];
    actorId?: string | null;
    actorNombre?: string | null;
  },
): Promise<number> {
  if (args.cambios.length === 0) return 0;
  await trx
    .insertInto("configuracion_historial")
    .values(
      args.cambios.map((c) => ({
        cliente: args.cliente,
        clinica_id: args.clinicaId,
        tabla: args.tabla,
        campo: c.campo,
        antes: aTexto(c.antes),
        despues: aTexto(c.despues),
        actor_id: args.actorId ?? null,
        actor_nombre: args.actorNombre ?? null,
      })),
    )
    .execute();
  return args.cambios.length;
}
