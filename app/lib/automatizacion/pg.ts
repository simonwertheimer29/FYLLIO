// app/lib/automatizacion/pg.ts
// Acceso a `eventos_automatizacion` — el log append-only de decisiones humanas.
// Fase 1 de PLAN-AGENTE. Ver `estado.ts` para por qué es un log y no una columna.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import type { CausaDerivacion, EventoAutomatizacion, TipoCaso } from "./estado";
import { parseObjetivos, type ObjetivoAgente } from "./objetivos";
import { parseConocimiento, type ConocimientoClinica } from "../agente/conocimiento";
import type { ClaveAplazado } from "./aplazamientos";

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
  /** Intención en el momento del envío. Viaja CON el evento porque después no
   *  se puede reconstruir: el clasificador la reescribe en la siguiente
   *  respuesta del paciente. */
  intencion?: string | null;
  /** Clave de taxonomía del aplazamiento (021). OBLIGATORIA en
   *  aplazado/aplazado_resuelto — el constraint de la base lo impone, y aquí
   *  el tipo lo recuerda antes. */
  claveAplazado?: ClaveAplazado | null;
  /** Causa de la derivación (022). OBLIGATORIA en `derivado`, y `malestar`
   *  obligatorio cuando la causa es `peticion_queja` (decide la cola). */
  causaDerivacion?: CausaDerivacion | null;
  malestar?: boolean | null;
  /** 026 — qué perseguía el agente al derivar (solo en `derivado`). Hecho del
   *  turno; decide qué hecho del sistema cierra el asunto (semaforo.ts). */
  objetivoActivo?: "identificar" | "cita" | "presupuesto" | "cobro" | null;
  /** 026 — «sin contacto hasta» (YYYY-MM-DD). OBLIGATORIA en `espera_fijada`
   *  y solo ahí (constraint). */
  hasta?: string | null;
};

/**
 * Inserta un evento. **LANZA si falla**, a propósito.
 *
 * No es telemetría: es el dato. Si un «asumido» o un «derivado» no se registra,
 * la cola entera cree otra cosa sobre quién lleva el caso.
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
        intencion: args.intencion ?? null,
        clave_aplazado: args.claveAplazado ?? null,
        causa_derivacion: args.causaDerivacion ?? null,
        malestar: args.malestar ?? null,
        objetivo_activo: args.objetivoActivo ?? null,
        hasta: args.hasta ?? null,
      } as never)
      .execute(),
  );
}

/**
 * Insert IDEMPOTENTE (024): mismo (cliente, evento, clave, mensaje_id) → una
 * sola fila, y el reintento es un no-op declarado, no un error. Es lo que hace
 * imposible que una doble entrega duplique aplazados — y el contador de
 * insistencia DECIDE derivaciones, así que un duplicado derivaría un caso que
 * no tocaba. Lanza si falla de verdad (§1); devuelve si insertó o ya estaba.
 */
export async function registrarEventoIdempotente(
  args: RegistrarEventoArgs & { mensajeId: string; evaluacionJson?: string | null },
): Promise<{ insertado: boolean }> {
  const cliente = requireCliente("registrarEventoIdempotente");
  const res = await runWithClienteDb(cliente, (trx) =>
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
        intencion: args.intencion ?? null,
        clave_aplazado: args.claveAplazado ?? null,
        causa_derivacion: args.causaDerivacion ?? null,
        malestar: args.malestar ?? null,
        objetivo_activo: args.objetivoActivo ?? null,
        hasta: args.hasta ?? null,
        evaluacion_json: args.evaluacionJson ?? null,
        mensaje_id: args.mensajeId,
      } as never)
      .onConflict((oc) => oc.doNothing())
      .execute(),
  );
  const n = Number(res?.[0]?.numInsertedOrUpdatedRows ?? 0);
  return { insertado: n > 0 };
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
  intencion?: string | null;
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

/**
 * El interruptor del evaluador (025). FAIL-CLOSED en cada eslabón: sin fila
 * → false; fallo de consulta → false con log. El estado seguro es el flujo
 * viejo, que está en producción — a diferencia de `objetivosDeClinica`, aquí
 * degradar SÍ es lo correcto: apagado no miente, solo observa menos.
 */
export async function evaluadorActivo(clinicaId?: string | null): Promise<boolean> {
  const cliente = requireCliente("evaluadorActivo");
  try {
    const r: any = await runWithClienteDb(cliente, (trx) =>
      sql`select evaluador_activo
          from configuracion_automatizaciones
          where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
          limit 1`.execute(trx),
    );
    return r.rows?.[0]?.evaluador_activo === true;
  } catch (err) {
    console.error("[automatizacion] evaluadorActivo:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Los objetivos del agente para una clínica (020). Sin fila o con la columna
 * NULL → los defaults del código: una clínica sin configurar se comporta como
 * una configurada por defecto.
 *
 * **LANZA** ante un JSON ilegible Y ante un fallo de consulta (endurecido el
 * 2026-08-13; antes caía al default con un log). Caer al default aquí sería
 * el agente persiguiendo objetivos que la clínica no eligió creyendo que sí —
 * el mismo pecado que `?? []` sobre un fetch (§10), con comportamiento en vez
 * de datos. El evaluador captura en SU borde y convierte a quiebre
 * fail-closed; a diferencia de `toquesAntesDeAgotar`, cuya validez la
 * garantiza el CHECK de la base, aquí el parser es la única puerta.
 */
export async function objetivosDeClinica(
  clinicaId?: string | null,
): Promise<readonly ObjetivoAgente[]> {
  const cliente = requireCliente("objetivosDeClinica");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select objetivos
        from configuracion_automatizaciones
        where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
        limit 1`.execute(trx),
  );
  return parseObjetivos(r.rows?.[0]?.objetivos ?? null);
}

/**
 * Lo PUBLICADO por la clínica (028, fase D grupo 2). Sin fila o columna NULL
 * → CONOCIMIENTO_VACIO: el agente aplaza todo, el comportamiento de hoy.
 *
 * **LANZA** ante un JSON ilegible Y ante un fallo de consulta — el mismo
 * contrato que `objetivosDeClinica`, por la misma razón: caer al vacío en
 * silencio sería el agente aplazando precios que la clínica cree publicados
 * (comportamiento en vez de datos, §10). El evaluador captura en SU borde.
 */
export async function conocimientoDeClinica(
  clinicaId?: string | null,
): Promise<ConocimientoClinica> {
  const cliente = requireCliente("conocimientoDeClinica");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select conocimiento
        from configuracion_automatizaciones
        where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
        limit 1`.execute(trx),
  );
  return parseConocimiento(r.rows?.[0]?.conocimiento ?? null);
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

export type FilaCoincidencia = {
  /** Clave del corte: intención, tipo de caso o semana ISO. */
  clave: string | null;
  distancias: number[];
};

/**
 * Los envíos medidos, en crudo, para agregarlos con la función pura compartida.
 *
 * Devuelve las DISTANCIAS y no un recuento por categoría a propósito: el umbral
 * que separa «editado» de «reescrito» vive en `coincidencia.ts` y hay que poder
 * cambiarlo sin tocar SQL ni perder el histórico. Si la base agregara por
 * categoría, el umbral estaría clavado en dos sitios.
 */
export async function enviosMedidos(desdeDias = 90): Promise<
  Array<{ distancia: number; intencion: string | null; tipoCaso: string; creadoAt: string }>
> {
  const cliente = requireCliente("enviosMedidos");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select distancia_edicion, intencion, tipo_caso, created_at
        from eventos_automatizacion
        where evento = 'mensaje_enviado'
          and distancia_edicion is not null
          and created_at >= now() - make_interval(days => ${desdeDias})
        order by created_at desc
        limit 5000`.execute(trx),
  );
  return (r.rows ?? [])
    .map((x: any) => ({
      distancia: Number(x.distancia_edicion),
      intencion: x.intencion ?? null,
      tipoCaso: String(x.tipo_caso),
      creadoAt: (x.created_at instanceof Date ? x.created_at : new Date(x.created_at)).toISOString(),
    }))
    .filter((x: any) => Number.isFinite(x.distancia));
}

/**
 * Cuántos envíos NO se pudieron medir por no haber mensaje sugerido. Es el
 * número que hace honesto al denominador: sin él, «12 de 12 tal cual» esconde
 * que hubo otros 40 que la coordinadora escribió de cero — y eso también dice
 * algo del agente, aunque no sea coincidencia.
 *
 * Se cuenta desde `mensajes_whatsapp` (salientes) menos los eventos medidos:
 * el evento solo existe cuando había sugerido, así que la diferencia son los
 * envíos sin propuesta.
 */
export async function enviosSinSugerido(desdeDias = 90): Promise<number> {
  const cliente = requireCliente("enviosSinSugerido");
  try {
    const r: any = await runWithClienteDb(cliente, (trx) =>
      sql`select
            (select count(*) from mensajes_whatsapp
              where direccion = 'Saliente'
                and timestamp >= now() - make_interval(days => ${desdeDias}))::int as salientes,
            (select count(*) from eventos_automatizacion
              where evento = 'mensaje_enviado'
                and created_at >= now() - make_interval(days => ${desdeDias}))::int as medidos`.execute(trx),
    );
    const salientes = Number(r.rows?.[0]?.salientes ?? 0);
    const medidos = Number(r.rows?.[0]?.medidos ?? 0);
    return Math.max(0, salientes - medidos);
  } catch (err) {
    console.error("[automatizacion] enviosSinSugerido:", err instanceof Error ? err.message : err);
    return 0;
  }
}
