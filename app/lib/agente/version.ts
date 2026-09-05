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

/** De qué salió el juicio. `null` en conocimiento/objetivos = no había nada
 *  publicado / ningún objetivo abierto (no es «desconocido», es «vacío»). */
export type VersionTurno = {
  evaluador: string;
  juez: string;
  conocimiento: string | null;
  objetivos: string | null;
};
