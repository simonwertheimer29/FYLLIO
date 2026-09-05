// app/lib/agente/borrador-agente.ts
//
// UN SOLO BORRADOR (auditoría 2026-09-05, punto 1 — MEJORAS 119).
//
// El evaluador juzga, veta y mide un borrador por turno y lo persiste en el
// payload del evento `evaluacion`. Hasta hoy NADIE lo enseñaba: el composer
// generaba OTRO con el borrador de entrada (que ni pasaba por el veto de
// agenda), y el eval medía un texto que no era el producto. Dos veces se
// midió un artefacto que no era lo que el usuario veía.
//
// Esta es la ÚNICA función que responde «¿qué propuso el agente para el
// último mensaje de esta persona?». La leen la ficha (para el composer) y
// las rutas de envío (para medir la coincidencia contra ESE texto). Devuelve
// null cuando el último entrante no tiene evaluación PROPIA — un borrador de
// un mensaje anterior no es un borrador: sería contestar a otra cosa.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import type { PayloadEvaluacion } from "./persistir-turno";
import { esLegible } from "../mensajeria/tipos-mensaje";

export type UltimoEntrante = {
  timestamp: string;
  wabaMessageId: string | null;
  tipo: string | null;
  legible: boolean;
};

export type BorradorAgente = {
  /** El texto tal cual salió del evaluador (ya juzgado y vetado). Vacío o
   *  null = el turno no produjo borrador (no legible, derivado sin texto). */
  texto: string | null;
  /** waba_message_id del entrante al que responde. */
  mensajeId: string;
  /** El juez lo tiró y esto es la plantilla: se dice, no se disfraza. */
  descartado: { motivo: string; frase: string | null } | null;
  idioma: string | null;
};

export type EstadoBorrador = {
  ultimoEntrante: UltimoEntrante | null;
  /** true ⇔ el ÚLTIMO entrante tiene su evaluación (o no hace falta: no era
   *  legible, o no hay entrante). false = el agente no lo evaluó (todavía, o
   *  nunca): la pantalla lo dice, no enseña el juicio anterior como actual. */
  alDia: boolean;
  borrador: BorradorAgente | null;
};

export async function estadoBorradorDe(telefono: string): Promise<EstadoBorrador> {
  const cliente = requireCliente("estadoBorradorDe");
  return runWithClienteDb(cliente, async (trx) => {
    const ue: any = await sql`
      select "timestamp", waba_message_id, tipo
        from mensajes_whatsapp
       where telefono = ${telefono} and direccion = 'Entrante' and "timestamp" is not null
       order by "timestamp" desc
       limit 1`.execute(trx);
    const fila = ue.rows?.[0];
    if (!fila) return { ultimoEntrante: null, alDia: true, borrador: null };
    const ultimoEntrante: UltimoEntrante = {
      timestamp: new Date(fila.timestamp).toISOString(),
      wabaMessageId: fila.waba_message_id ? String(fila.waba_message_id) : null,
      tipo: fila.tipo ? String(fila.tipo) : null,
      legible: esLegible(fila.tipo ?? null),
    };
    // Un entrante no legible no tiene borrador por diseño: al día.
    if (!ultimoEntrante.legible) return { ultimoEntrante, alDia: true, borrador: null };

    // La evaluación PROPIA del último entrante: por mensaje_id si lo hay
    // (webhook), o la posterior al entrante si es un registro manual sin id.
    const ev: any = ultimoEntrante.wabaMessageId
      ? await sql`
          select mensaje_id, evaluacion_json, created_at
            from eventos_automatizacion
           where tipo_caso = 'conversacion' and caso_id = ${telefono}
             and evento = 'evaluacion' and mensaje_id = ${ultimoEntrante.wabaMessageId}
           order by created_at desc limit 1`.execute(trx)
      : await sql`
          select mensaje_id, evaluacion_json, created_at
            from eventos_automatizacion
           where tipo_caso = 'conversacion' and caso_id = ${telefono}
             and evento = 'evaluacion' and created_at >= ${fila.timestamp}
           order by created_at desc limit 1`.execute(trx);
    const e = ev.rows?.[0];
    if (!e?.evaluacion_json) return { ultimoEntrante, alDia: false, borrador: null };
    let payload: PayloadEvaluacion | null = null;
    try {
      payload = JSON.parse(String(e.evaluacion_json)) as PayloadEvaluacion;
    } catch {
      return { ultimoEntrante, alDia: false, borrador: null };
    }
    const texto = (payload.respuesta ?? "").trim();
    return {
      ultimoEntrante,
      alDia: true,
      borrador: {
        texto: texto || null,
        mensajeId: String(e.mensaje_id ?? ultimoEntrante.wabaMessageId ?? ""),
        descartado: payload.borradorDescartado ?? null,
        idioma: payload.idioma ?? null,
      },
    };
  });
}

/** Solo el texto, para medir la coincidencia en las rutas de envío: `null`
 *  cuando no hay borrador al día (el envío no entra en el denominador). */
export async function borradorAgenteDe(telefono: string): Promise<string | null> {
  try {
    const est = await estadoBorradorDe(telefono);
    return est.alDia ? est.borrador?.texto ?? null : null;
  } catch (err) {
    console.error("[borrador-agente] no se pudo leer el borrador de", telefono, err instanceof Error ? err.message : err);
    return null;
  }
}
