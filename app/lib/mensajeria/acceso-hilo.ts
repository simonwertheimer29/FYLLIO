// app/lib/mensajeria/acceso-hilo.ts
//
// QUIÉN PUEDE VER UN HILO (decisión 2026-09-05, MEJORAS 122 — hilo único por
// persona en una red de clínicas).
//
// El hilo es de la PERSONA, no de una clínica: si escribió a la clínica A el
// mes pasado y a la B hoy, es una sola conversación, y partirla escondería
// media a quien la necesita. Así que lo ve quien tenga acceso a CUALQUIERA de
// las clínicas por las que ha pasado el hilo; los mensajes van etiquetados
// con la suya. Un hilo sin clínica solo lo ve la red (decisión 2026-08-11).
//
// Antes cada ruta miraba «la clínica del último mensaje que la tenga» — con
// un criterio distinto en la ficha (la clínica de la FICHA del paciente). Un
// solo criterio, aquí, y todas las rutas lo llaman (§5: un filtro de acceso
// se prueba intentando saltárselo; §16: una definición, no cinco copias).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

/** Las clínicas por las que ha pasado el hilo (sin nulos, sin repetir), y la
 *  del último mensaje que la tenga — la «principal» para etiquetas y cola. */
export async function clinicasDelHilo(telefono: string): Promise<{ todas: string[]; ultima: string | null }> {
  const cliente = requireCliente("clinicasDelHilo");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ clinica_id: string | null }>`
      select clinica_id
        from mensajes_whatsapp
       where telefono = ${telefono} and "timestamp" is not null
       order by "timestamp" desc`.execute(trx),
  );
  const todas: string[] = [];
  let ultima: string | null = null;
  for (const f of r.rows) {
    if (!f.clinica_id) continue;
    const id = String(f.clinica_id);
    if (ultima == null) ultima = id;
    if (!todas.includes(id)) todas.push(id);
  }
  return { todas, ultima };
}

/** La regla. `permitidas === null` = acceso de red (admin). */
export function puedeVerHilo(permitidas: string[] | null, clinicas: readonly string[]): boolean {
  if (permitidas === null) return true;
  if (clinicas.length === 0) return false;
  return clinicas.some((c) => permitidas.includes(c));
}

/** Para las rutas que ya tienen el hilo cargado (hiloDe): mismas reglas sin
 *  otra consulta. */
export function clinicasDeMensajes(mensajes: ReadonlyArray<{ clinicaId: string | null }>): string[] {
  const out: string[] = [];
  for (const m of mensajes) if (m.clinicaId && !out.includes(m.clinicaId)) out.push(m.clinicaId);
  return out;
}
