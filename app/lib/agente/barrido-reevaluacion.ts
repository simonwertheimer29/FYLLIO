// app/lib/agente/barrido-reevaluacion.ts
//
// EL BARRIDO DE REEVALUACIÓN (plan maestro fase 0.1, MEJORAS 163). Hasta hoy,
// si el modelo no respondía o `after()` moría, el turno se perdía: el caso
// quedaba en «Sin evaluar» hasta que alguien lo viera o el paciente volviera
// a escribir. Esto busca los ÚLTIMOS entrantes de cada hilo que llevan más de
// N minutos sin evaluación ni respuesta humana y los vuelve a pasar por el
// orquestador — que es idempotente por `mensaje_id` (024), así que un barrido
// que coincide con la evaluación viva no duplica nada.
//
// Quién lo llama, mientras no exista la cola de trabajos (164):
//   · el webhook de WhatsApp, al final de cada lote (hasta 3 hilos): con
//     tráfico hay reintentos sin infraestructura;
//   · /api/cron/reevaluar (todos los clientes) y el cron diario (suelo).
// Con la cola, esto pasa a ser un trabajo programado cada pocos minutos y el
// webhook deja de barrer. La función no cambia.
//
// Lo que NO reevalúa: hilos con un saliente posterior al entrante (una persona
// ya contestó), gestos (sticker, reacción), y clínicas con el evaluador
// apagado. Lo no legible sí entra: el orquestador lo deriva sin modelo.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { evaluadorActivo } from "../automatizacion/pg";
import { evaluarEntranteConversacion } from "./evaluar-entrante";
import { esGesto, type TipoMensaje } from "../mensajeria/tipos-mensaje";

export type ResultadoBarrido = {
  candidatos: number;
  reevaluados: number;
  saltados: { evaluador_apagado: number; gesto: number; error: number };
  telefonos: string[];
};

type Candidato = {
  id: string;
  telefono: string;
  waba_message_id: string | null;
  contenido: string | null;
  tipo: string | null;
  clinica_id: string | null;
  timestamp: Date | string;
};

export async function barridoReevaluacion(opts?: {
  /** Edad mínima del entrante para considerarlo perdido. Default 5. */
  minutosMin?: number;
  /** No se mira más atrás de esto. Default 48 h. */
  horasMax?: number;
  /** Cuántos hilos como máximo por pasada. Default 10. */
  tope?: number;
  /** Hilos que el caller ya está evaluando ahora (el lote del webhook). */
  excluir?: readonly string[];
  /** Instante inyectado desde el borde (§14): el QA viaja en el tiempo con
   *  esto. Default: ahora real. */
  ahora?: Date;
  /** Solo listar candidatos, sin evaluar (cero coste de modelo): para el QA
   *  y para inspeccionar qué reevaluaría una pasada. */
  soloListar?: boolean;
}): Promise<ResultadoBarrido> {
  const cliente = requireCliente("barridoReevaluacion");
  const minutosMin = opts?.minutosMin ?? 5;
  const horasMax = opts?.horasMax ?? 48;
  const tope = Math.max(1, Math.min(opts?.tope ?? 10, 50));
  const excluir = new Set(opts?.excluir ?? []);
  const ahora = opts?.ahora ?? new Date();

  const filas = await runWithClienteDb(cliente, async (trx) => {
    const r = await sql<Candidato>`
      with ultimos as (
        select distinct on (m.telefono)
               m.id, m.telefono, m.waba_message_id, m.contenido, m.tipo, m.clinica_id, m."timestamp"
          from mensajes_whatsapp m
         where m.direccion = 'Entrante' and m.telefono is not null and m."timestamp" is not null
           and m."timestamp" >= ${ahora}::timestamptz - make_interval(hours => ${horasMax})
         order by m.telefono, m."timestamp" desc
      )
      select u.*
        from ultimos u
       where u."timestamp" <= ${ahora}::timestamptz - make_interval(mins => ${minutosMin})
         and not exists (
           select 1 from mensajes_whatsapp s
            where s.telefono = u.telefono and s.direccion = 'Saliente' and s."timestamp" > u."timestamp")
         and not exists (
           select 1 from eventos_automatizacion e
            where e.tipo_caso = 'conversacion' and e.caso_id = u.telefono
              and e.evento in ('evaluacion', 'derivado')
              and (
                (u.waba_message_id is not null and e.mensaje_id = u.waba_message_id)
                or (u.waba_message_id is null and e.created_at >= u."timestamp")
              ))
       order by u."timestamp" asc
       limit ${tope + excluir.size}`.execute(trx);
    return r.rows ?? [];
  });

  const out: ResultadoBarrido = {
    candidatos: 0,
    reevaluados: 0,
    saltados: { evaluador_apagado: 0, gesto: 0, error: 0 },
    telefonos: [],
  };
  for (const c of filas) {
    if (excluir.has(c.telefono)) continue;
    if (out.candidatos >= tope) break;
    out.candidatos++;
    const tipo = (c.tipo ?? "text") as TipoMensaje;
    if (esGesto(tipo) && tipo !== "reaction") {
      out.saltados.gesto++;
      continue;
    }
    if (opts?.soloListar) {
      out.telefonos.push(c.telefono);
      continue;
    }
    if (!(await evaluadorActivo(c.clinica_id ?? null))) {
      out.saltados.evaluador_apagado++;
      continue;
    }
    try {
      await evaluarEntranteConversacion({
        telefono: c.telefono,
        mensajeId: c.waba_message_id ?? String(c.id),
        contenido: String(c.contenido ?? ""),
        tipo,
        clinicaId: c.clinica_id ?? null,
      });
      out.reevaluados++;
      out.telefonos.push(c.telefono);
    } catch (err) {
      // El orquestador ya avisa por la campana de lo sistemático; aquí solo
      // se cuenta y se sigue con el siguiente hilo.
      out.saltados.error++;
      const { registrarIncidencia } = await import("../incidencias");
      await registrarIncidencia({ tipo: "agente", motivo: "barrido_hilo_fallo", origen: "agente/barrido-reevaluacion", referencia: c.waba_message_id, clinicaId: c.clinica_id ?? null, error: err, reintentable: true, soloLog: `tel=${c.telefono}` });
    }
  }
  return out;
}
