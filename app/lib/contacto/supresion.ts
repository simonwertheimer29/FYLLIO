// app/lib/contacto/supresion.ts
//
// EL BORRADO DE UNA CONVERSACIÓN (plan maestro fase 0.3, MEJORAS 147,
// migración 039). Hasta hoy no existía ningún camino: borrar la ficha del
// paciente no tocaba sus mensajes ni los juicios del agente, que van por
// teléfono y no por id — un derecho de supresión (art. 17) no se podía
// atender. Aquí está el ÚNICO código que borra del log append-only.
//
// Qué se borra, por teléfono (dígitos): mensajes_whatsapp, los eventos de la
// conversación (tipo_caso = 'conversacion'), lo visto en Seguimiento, la cola
// de envíos y las secuencias pendientes de ese número. Qué se GUARDA: una fila
// en `supresiones` con el hash del teléfono, el motivo, quién y cuántas filas
// por tabla — la prueba de que se atendió, sin el contenido.
//
// Un teléfono COMPARTIDO (madre e hijo, dos fichas) es la trampa: borrar «la
// conversación de este paciente» borraría la de la otra persona. Quien llama
// desde una ficha comprueba `telefonoCompartido` antes; el derecho de
// supresión pedido por la persona sí borra el hilo entero (es SU número).
//
// La RETENCIÓN (caducidad por plazo) usa el mismo borrado, hilo a hilo, y
// solo corre con un plazo declarado (RETENCION_CONVERSACIONES_DIAS): sin
// plazo del abogado no se borra nada, y se dice.

import { createHash } from "node:crypto";
import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

export type MotivoSupresion = "derecho_supresion" | "retencion" | "baja_paciente" | "qa";

export type ResultadoSupresion = {
  telefonoHash: string;
  mensajes: number;
  eventos: number;
  otros: Record<string, number>;
};

const soloDigitos = (raw: string): string => raw.replace(/[^0-9]/g, "");

/** Hash de identidad del teléfono para el registro de supresiones: permite
 *  demostrar «este número se borró el día X» sin volver a guardar el número. */
export function hashTelefono(telefono: string): string {
  return createHash("sha256").update(soloDigitos(telefono), "utf8").digest("hex").slice(0, 16);
}

/** Cuántas fichas y leads casan con el número (quien borra desde una ficha
 *  necesita saber si el hilo es de más personas). */
export async function telefonoCompartido(telefono: string): Promise<{ pacientes: number; leads: number }> {
  const cliente = requireCliente("telefonoCompartido");
  const dig = soloDigitos(telefono);
  if (dig.length < 7) return { pacientes: 0, leads: 0 };
  const patron = `%${dig}%`;
  return runWithClienteDb(cliente, async (trx) => {
    const r = await sql<{ pacientes: number; leads: number }>`select
      (select count(*)::int from pacientes where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}) as pacientes,
      (select count(*)::int from leads where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}) as leads`.execute(trx);
    const f = r.rows?.[0];
    return { pacientes: Number(f?.pacientes ?? 0), leads: Number(f?.leads ?? 0) };
  });
}

/**
 * Borra la conversación de un teléfono y deja la anotación. Todo en UNA
 * transacción: o se borra y se anota, o nada (§1). Lanza si el teléfono no
 * tiene identificador suficiente — borrar con un patrón corto barrería medio
 * país.
 */
export async function borrarConversacion(args: {
  telefono: string;
  motivo: MotivoSupresion;
  actorId?: string | null;
  actorNombre?: string | null;
}): Promise<ResultadoSupresion> {
  const cliente = requireCliente("borrarConversacion");
  const dig = soloDigitos(args.telefono);
  if (dig.length < 7) throw new Error("borrarConversacion: teléfono sin identificador suficiente");
  const patron = `%${dig}%`;
  const hash = hashTelefono(args.telefono);

  return runWithClienteDb(cliente, async (trx) => {
    const n = async (q: ReturnType<typeof sql<{ n: number }>>) => Number((await q.execute(trx)).rows?.[0]?.n ?? 0);
    const mensajes = await n(sql<{ n: number }>`with d as (
        delete from mensajes_whatsapp
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}
         returning 1) select count(*)::int as n from d`);
    const eventos = await n(sql<{ n: number }>`with d as (
        delete from eventos_automatizacion
         where tipo_caso = 'conversacion'
           and replace(replace(replace(caso_id, ' ', ''), '+', ''), '-', '') like ${patron}
         returning 1) select count(*)::int as n from d`);
    const vistos = await n(sql<{ n: number }>`with d as (
        delete from seguimiento_vistos
         where tipo_caso = 'conversacion'
           and replace(replace(replace(caso_id, ' ', ''), '+', ''), '-', '') like ${patron}
         returning 1) select count(*)::int as n from d`);
    const cola = await n(sql<{ n: number }>`with d as (
        delete from cola_envios
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}
         returning 1) select count(*)::int as n from d`);
    const secuencias = await n(sql<{ n: number }>`with d as (
        delete from secuencias_automaticas
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}
         returning 1) select count(*)::int as n from d`);
    const otros = { seguimiento_vistos: vistos, cola_envios: cola, secuencias_automaticas: secuencias };
    await trx
      .insertInto("supresiones")
      .values({
        cliente,
        telefono_hash: hash,
        motivo: args.motivo,
        actor_id: args.actorId ?? null,
        actor_nombre: args.actorNombre ?? null,
        mensajes_borrados: mensajes,
        eventos_borrados: eventos,
        otros_borrados: JSON.stringify(otros),
      })
      .execute();
    return { telefonoHash: hash, mensajes, eventos, otros };
  });
}

/** El plazo declarado, o null = sin plazo (no se borra nada por caducidad). */
export function plazoRetencionDias(): number | null {
  const v = process.env["RETENCION_CONVERSACIONES_DIAS"];
  if (!v) return null;
  const nro = Number(v);
  return Number.isInteger(nro) && nro > 0 ? nro : null;
}

/**
 * Caducidad por plazo: los hilos cuyo ÚLTIMO mensaje es anterior a `dias`
 * días y cuyo teléfono no es de un paciente con cita futura ni presupuesto
 * vivo (una conversación de alguien en tratamiento no caduca sola; el plazo
 * fino lo dirá el abogado). `dry` lista sin borrar.
 */
export async function retencionConversaciones(args: {
  dias: number;
  ahora?: Date;
  tope?: number;
  dry?: boolean;
}): Promise<{ candidatos: string[]; borrados: ResultadoSupresion[] }> {
  const cliente = requireCliente("retencionConversaciones");
  const ahora = args.ahora ?? new Date();
  const tope = Math.max(1, Math.min(args.tope ?? 50, 500));
  const filas = await runWithClienteDb(cliente, async (trx) => {
    const r = await sql<{ telefono: string }>`
      select m.telefono
        from mensajes_whatsapp m
       where m.telefono is not null
       group by m.telefono
      having max(m."timestamp") < ${ahora}::timestamptz - make_interval(days => ${args.dias})
         and not exists (
           select 1 from pacientes p
            where replace(replace(replace(coalesce(p.telefono,''), ' ', ''), '+', ''), '-', '')
                  like '%' || replace(replace(replace(m.telefono, ' ', ''), '+', ''), '-', '') || '%'
              and (exists (select 1 from citas c where c.paciente_id = p.id and c.hora_inicio >= ${ahora}::timestamptz)
                   or exists (select 1 from presupuestos pr where pr.paciente_id = p.id
                                and (pr.estado is null or pr.estado not in ('ACEPTADO', 'PERDIDO')))))
       order by max(m."timestamp") asc
       limit ${tope}`.execute(trx);
    return (r.rows ?? []).map((x) => String(x.telefono));
  });
  const borrados: ResultadoSupresion[] = [];
  if (!args.dry) {
    for (const telefono of filas) {
      borrados.push(await borrarConversacion({ telefono, motivo: "retencion", actorNombre: "retencion" }));
    }
  }
  return { candidatos: filas, borrados };
}
