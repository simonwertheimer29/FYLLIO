// app/lib/automatizacion/servicio.ts
//
// Enriquecido de una cola con la tercera coordenada. Fase 1 de PLAN-AGENTE.
//
// UN SOLO SITIO donde se compone el estado, igual que `estadoConversacion` es un
// solo sitio para "quién tiene la pelota". Si la cola de presupuestos y la de
// leads lo compusieran cada una por su cuenta, volveríamos al problema que ese
// módulo vino a resolver: el mismo caso saliendo distinto en dos pantallas.
//
// El cálculo vive en el SERVIDOR y viaja ya resuelto al cliente. El cliente no
// recalcula criterio — misma doctrina que `conversacion`.

import { estadoAutomatizacion, motivoLegible, type EstadoDerivado, type TipoCaso } from "./estado";
import { ultimosEventosPorCaso, toquesAntesDeAgotar } from "./pg";
import type { EstadoConversacion } from "../presupuestos/estado-conversacion";
import type { IntencionDetectada } from "../presupuestos/types";

export type CasoParaEstado = {
  id: string;
  cerrado: boolean;
  conversacion: EstadoConversacion;
  /** Solo presupuestos: en leads siempre null (el webhook no los clasifica). */
  intencion?: IntencionDetectada | null;
  /** `contact_count` en presupuestos, `whatsapp_enviados` en leads. */
  toques: number;
  /** La frase real del paciente, para componer el motivo legible. */
  ultimaRespuesta?: string | null;
};

export type ResultadoEstado = EstadoDerivado & { motivo: string | null };

/**
 * Resuelve el estado de una lista entera. Dos consultas en total —el mapa de
 * últimos eventos y el umbral—, no dos por tarjeta: la cola de intervención ya
 * pagó una vez el patrón de consultar por fila.
 */
export async function resolverEstados(
  tipoCaso: TipoCaso,
  casos: readonly CasoParaEstado[],
  opciones?: { clinicaId?: string | null },
): Promise<Map<string, ResultadoEstado>> {
  const salida = new Map<string, ResultadoEstado>();
  if (casos.length === 0) return salida;

  const [eventos, umbral] = await Promise.all([
    ultimosEventosPorCaso(tipoCaso),
    toquesAntesDeAgotar(opciones?.clinicaId ?? null),
  ]);

  for (const c of casos) {
    const derivado = estadoAutomatizacion({
      cerrado: c.cerrado,
      conversacion: c.conversacion,
      intencion: c.intencion ?? null,
      toques: c.toques,
      toquesAntesDeAgotar: umbral,
      ultimoEvento: eventos.get(c.id) ?? null,
    });
    salida.set(c.id, {
      ...derivado,
      motivo: derivado.disparador ? motivoLegible(derivado.disparador, c.ultimaRespuesta) : null,
    });
  }
  return salida;
}

/**
 * Versión degradada para cuando la consulta de eventos falla. Devuelve el estado
 * DERIVADO sin la capa humana, en vez de dejar los casos sin estado.
 *
 * Justificación (§3, matiz): fail-closed aplica a acceso y datos; una capa
 * auxiliar caída se degrada con log y no tumba la puerta principal. Aquí el coste
 * de degradar es acotado y conocido —un caso que alguien había asumido vuelve a
 * verse como quebrado, o sea que se avisa DE MÁS— y el de no degradar sería
 * dejar la cola entera sin la cohorte de quiebre justo cuando la base va mal.
 * Se escala de más, que es la asimetría correcta.
 */
export function estadosSinEventos(
  casos: readonly CasoParaEstado[],
  umbral = 3,
): Map<string, ResultadoEstado> {
  const salida = new Map<string, ResultadoEstado>();
  for (const c of casos) {
    const derivado = estadoAutomatizacion({
      cerrado: c.cerrado,
      conversacion: c.conversacion,
      intencion: c.intencion ?? null,
      toques: c.toques,
      toquesAntesDeAgotar: umbral,
      ultimoEvento: null,
    });
    salida.set(c.id, {
      ...derivado,
      motivo: derivado.disparador ? motivoLegible(derivado.disparador, c.ultimaRespuesta) : null,
    });
  }
  return salida;
}
