// app/lib/automatizacion/medir-envio.ts
//
// El enganche de la coincidencia agente-humano en el camino del envío.
// Fase 1 de PLAN-AGENTE.
//
// ─── Por qué se mide en el SERVIDOR y no en el cliente ──────────────────────
//
// El sugerido se lee de la base (`mensaje_sugerido`), no de lo que mande el
// navegador. Si el cliente enviara "esto es lo que me propusiste", la métrica
// mediría lo que el cliente dice, no lo que el agente propuso: bastaría un
// composer que reenviara el texto ya editado para que la tasa saliera del 100 %
// sin que nadie mintiera a propósito. Una métrica que decide cuándo se sube de
// modo A a modo B no puede depender de eso.
//
// Nunca lanza: el mensaje ya salió, y perder un envío correcto por no poder
// anotar una métrica sería cambiar un dato perdido por algo peor. Pero el fallo
// se loguea (§9).

import { medirCoincidencia } from "./coincidencia";
import { registrarEnvioMedido } from "./pg";
import type { TipoCaso } from "./estado";

/**
 * Mide y registra un envío saliente.
 *
 * @param sugerido Lo que el agente dejó preparado, LEÍDO DE LA BASE. `null` o
 *                 vacío → el envío no entra en el denominador (la coordinadora
 *                 escribió de cero, y eso no dice nada sobre si el agente acierta).
 */
export async function medirYRegistrarEnvio(args: {
  tipoCaso: TipoCaso;
  casoId: string;
  sugerido: string | null | undefined;
  enviado: string;
  actorId?: string | null;
  actorNombre?: string | null;
}): Promise<void> {
  const medida = medirCoincidencia(args.sugerido, args.enviado);
  if (!medida.medible) return; // sin sugerido no hay nada que comparar

  await registrarEnvioMedido({
    tipoCaso: args.tipoCaso,
    casoId: args.casoId,
    actorId: args.actorId ?? null,
    actorNombre: args.actorNombre ?? null,
    distanciaEdicion: medida.distancia,
    largoSugerido: medida.largoSugerido,
  });
}
