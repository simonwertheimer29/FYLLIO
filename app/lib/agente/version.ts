// app/lib/agente/version.ts
//
// LA VERSIÓN DE UN JUICIO (plan maestro, MEJORAS 168). Hasta hoy el payload de
// cada turno llevaba `v: 1` y el `modelo`; el system prompt era una constante
// en git sin rastro en el dato. Ningún juicio del histórico era atribuible a
// una versión — y sin eso no hay «v2 mejor que v1» sobre conversaciones
// reales, ni replay exacto.
//
// El hash es de IDENTIDAD, no de seguridad: doce hex de sha256 bastan para
// distinguir versiones de un prompt. Se calcula sobre el texto TAL CUAL se
// mandó (override incluido), nunca sobre un nombre que alguien tenga que
// acordarse de subir.

import { createHash } from "node:crypto";

export function hashVersion(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 12);
}

/** LA HUELLA DE UN TEXTO ETIQUETADO (MEJORAS 239, 14-09). El mismo hash de
 *  identidad, con otro nombre porque no identifica una versión de prompt sino
 *  el texto CONCRETO al que se refiere una etiqueta de Simon: la clave de un
 *  candidato del corpus la lleva dentro, y así rejugar un hilo crea candidatos
 *  nuevos (sin etiqueta, visibles como pendientes) en vez de heredar las viejas.
 *
 *  SIN NORMALIZAR, y es a propósito: se hashea el texto TAL CUAL se guardó. La
 *  migración 055 calcula la misma huella en SQL (`sha256` de Postgres sobre el
 *  mismo `texto`), y dos normalizaciones escritas en dos lenguajes es justo la
 *  forma de que un día dejen de coincidir sin que nadie lo note. */
export const huellaTexto = (texto: string): string => hashVersion(texto);

/** De qué salió el juicio. `null` en conocimiento/objetivos = no había nada
 *  publicado / ningún objetivo abierto (no es «desconocido», es «vacío»). */
export type VersionTurno = {
  evaluador: string;
  juez: string;
  conocimiento: string | null;
  objetivos: string | null;
};
