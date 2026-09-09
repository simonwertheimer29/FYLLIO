// app/lib/metricas/conversacion.ts
//
// La consulta de «Qué dicen» (2.1, MEJORAS 176): los eventos del agente de
// las dos ventanas (la pedida y la anterior, días completos hasta ayer) con su
// sede —la del último mensaje del hilo, como en Confianza— y la agregación
// pura de `conversacion.tipos`. `ahora` viaja hasta el fondo (§14): el QA lo
// fija. Solo lo persistido: ni una llamada al modelo.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO, sumaDias, TZ_CLINICA } from "../time";
import { agregarConversacion, type Conversacion, type EventoConversacion, type VentanaConversacion } from "./conversacion.tipos";

export * from "./conversacion.tipos";

type Fila = {
  telefono: string;
  clinica_id: string | null;
  evento: "evaluacion" | "aplazado" | "derivado";
  dia: string;
  clave: string | null;
  motivo: string | null;
  campos: unknown;
};

const objeto = (v: unknown): EventoConversacion["campos"] => {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as EventoConversacion["campos"];
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? (v as EventoConversacion["campos"]) : null;
};

export async function calcularConversacion(opts: { clinicaId: string | null; dias: VentanaConversacion; ahora?: Date }): Promise<Conversacion> {
  const cliente = requireCliente("metricas/conversacion");
  const hoy = hoyISO(opts.ahora ?? new Date());
  const hasta = sumaDias(hoy, -1);
  const desde = sumaDias(hasta, -(opts.dias - 1));
  const hastaPrevia = sumaDias(desde, -1);
  const desdePrevia = sumaDias(hastaPrevia, -(opts.dias - 1));
  const tz = TZ_CLINICA;
  const clinicaId = opts.clinicaId;

  const r = await runWithClienteDb(cliente, (trx) =>
    sql<Fila>`
      with cl as (
        select telefono,
               (array_agg(clinica_id order by "timestamp" desc) filter (where clinica_id is not null))[1] as clinica_id
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null
         group by telefono
      )
      select e.caso_id as telefono, cl.clinica_id, e.evento,
             to_char((e.created_at at time zone ${tz})::date, 'YYYY-MM-DD') as dia,
             coalesce(e.clave_aplazado, e.causa_derivacion) as clave,
             e.motivo_texto as motivo,
             case when e.evento = 'evaluacion' and e.evaluacion_json is not null and jsonb_typeof(e.evaluacion_json) = 'object'
                  then e.evaluacion_json -> 'camposRecogidos' else null end as campos
        from eventos_automatizacion e
        left join cl on cl.telefono = e.caso_id
       where e.tipo_caso = 'conversacion' and e.evento in ('evaluacion', 'aplazado', 'derivado')
         and e.created_at >= (${desdePrevia}::date::timestamp at time zone ${tz})
         and e.created_at <  (${hoy}::date::timestamp at time zone ${tz})
         and (${clinicaId}::text is null or cl.clinica_id = ${clinicaId})
       order by e.created_at asc`.execute(trx),
  );
  const eventos: EventoConversacion[] = r.rows.map((f) => ({
    telefono: String(f.telefono),
    clinicaId: f.clinica_id == null ? null : String(f.clinica_id),
    evento: f.evento,
    dia: String(f.dia),
    clave: f.clave,
    motivo: f.motivo,
    campos: objeto(f.campos),
  }));
  return agregarConversacion(eventos, { desde, hasta, dias: opts.dias }, { desde: desdePrevia, hasta: hastaPrevia });
}
