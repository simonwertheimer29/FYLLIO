// app/lib/automatizacion/pg.ts
// Acceso a `eventos_automatizacion` — el log append-only de decisiones humanas.
// Fase 1 de PLAN-AGENTE. Ver `estado.ts` para por qué es un log y no una columna.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import type { EventoAutomatizacion, TipoCaso } from "./estado";

/**
 * Último evento humano de cada caso de un tipo. Una sola consulta para toda la
 * cola: `distinct on` con el índice `(cliente, tipo_caso, caso_id, created_at desc)`.
 *
 * Se carga en bloque a propósito. La alternativa —una consulta por tarjeta—
 * es el patrón que ya costó caro en rate-limit (dos SELECT completos por envío)
 * y en la cola de intervención.
 */
export async function ultimosEventosPorCaso(
  tipoCaso: TipoCaso,
): Promise<Map<string, EventoAutomatizacion>> {
  const cliente = requireCliente("ultimosEventosPorCaso");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select distinct on (caso_id) caso_id, evento
        from eventos_automatizacion
        where tipo_caso = ${tipoCaso}
        order by caso_id, created_at desc`.execute(trx),
  );
  const mapa = new Map<string, EventoAutomatizacion>();
  for (const row of r.rows ?? []) mapa.set(String(row.caso_id), row.evento as EventoAutomatizacion);
  return mapa;
}

export type RegistrarEventoArgs = {
  tipoCaso: TipoCaso;
  casoId: string;
  evento: EventoAutomatizacion;
  actorId?: string | null;
  actorNombre?: string | null;
  motivoTexto?: string | null;
  /** Coincidencia agente-humano; solo en `mensaje_enviado`. */
  distanciaEdicion?: number | null;
  largoSugerido?: number | null;
};

/**
 * Inserta un evento. **LANZA si falla**, a propósito.
 *
 * No es telemetría: es el dato. Si «devolver al agente» no se registra, el caso
 * se queda en manos de alguien para siempre y la coordinadora cree que lo soltó.
 * Un catch silencioso aquí convierte una decisión en un caso perdido — que es
 * exactamente el fallo que costó semanas en `logAccionLead` (§9).
 *
 * La excepción es `mensaje_enviado`: ver `registrarEnvioMedido`.
 */
export async function registrarEvento(args: RegistrarEventoArgs): Promise<void> {
  const cliente = requireCliente("registrarEvento");
  await runWithClienteDb(cliente, (trx) =>
    trx
      .insertInto("eventos_automatizacion" as never)
      .values({
        cliente,
        tipo_caso: args.tipoCaso,
        caso_id: args.casoId,
        evento: args.evento,
        actor_id: args.actorId ?? null,
        actor_nombre: args.actorNombre ?? null,
        motivo_texto: args.motivoTexto ?? null,
        distancia_edicion: args.distanciaEdicion ?? null,
        largo_sugerido: args.largoSugerido ?? null,
      } as never)
      .execute(),
  );
}

/**
 * Registra la medida de coincidencia de un envío. A DIFERENCIA de `registrarEvento`,
 * este NO lanza: el mensaje ya salió, y tumbar la respuesta de un envío correcto
 * porque no se pudo anotar una métrica sería cambiar un dato perdido por un envío
 * perdido. Pero el fallo se loguea con contexto suficiente para reconciliar (§9),
 * porque si falla el 100% de las veces la tasa se quedaría en blanco sin decir por qué.
 */
export async function registrarEnvioMedido(args: {
  tipoCaso: TipoCaso;
  casoId: string;
  actorId?: string | null;
  actorNombre?: string | null;
  distanciaEdicion: number | null;
  largoSugerido: number | null;
}): Promise<void> {
  try {
    await registrarEvento({ ...args, evento: "mensaje_enviado" });
  } catch (err) {
    console.error(
      `[automatizacion] no se pudo registrar la coincidencia de ${args.tipoCaso}:${args.casoId}`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * `toques_antes_de_agotar` de la clínica. Sin fila de configuración → 3, el
 * mismo default que declara la migración: un caso sin configurar tiene que
 * comportarse igual que uno configurado por defecto, no quedarse sin estado.
 */
export async function toquesAntesDeAgotar(clinicaId?: string | null): Promise<number> {
  const cliente = requireCliente("toquesAntesDeAgotar");
  try {
    const r: any = await runWithClienteDb(cliente, (trx) =>
      sql`select toques_antes_de_agotar as n
          from configuracion_automatizaciones
          where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
          limit 1`.execute(trx),
    );
    const n = Number(r.rows?.[0]?.n);
    return Number.isFinite(n) && n > 0 ? n : 3;
  } catch (err) {
    console.error("[automatizacion] toquesAntesDeAgotar:", err instanceof Error ? err.message : err);
    return 3;
  }
}

/** Distancias de los envíos medibles, para la tasa de coincidencia. */
export async function distanciasDeEnvios(limite = 500): Promise<number[]> {
  const cliente = requireCliente("distanciasDeEnvios");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select distancia_edicion
        from eventos_automatizacion
        where evento = 'mensaje_enviado' and distancia_edicion is not null
        order by created_at desc
        limit ${limite}`.execute(trx),
  );
  return (r.rows ?? []).map((x: any) => Number(x.distancia_edicion)).filter(Number.isFinite);
}
