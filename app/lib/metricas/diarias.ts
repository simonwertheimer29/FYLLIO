// app/lib/metricas/diarias.ts
//
// MÉTRICAS POR DÍA (plan maestro fase 1, MEJORAS 172). Lo que abre la fase 2:
// el antes/después por clínica (181), los detalles de Inicio (158) y las
// anomalías (203) leen de aquí, no recalculan sobre crudo cada vez.
//
// Reglas:
//   · Cada métrica se define UNA vez, aquí, y lleva versión (DEFINICION_V).
//     Cambiar una definición exige subir la versión: la serie vieja y la
//     nueva no se mezclan.
//   · Todo se deriva de datos crudos con timestamp → admite backfill. El día
//     es el día de la CLÍNICA (Europe/Madrid), nunca UTC (§13).
//   · Sin contenido: números. Ningún texto de paciente entra en la tabla.
//   · `n` acompaña a cada valor: una mediana sobre 1 caso no es una mediana,
//     y quien pinta tiene que poder decirlo.
//
// Definiciones v1 (lo que cuenta cada una y lo que NO):
//   tiempo_respuesta_mediana_min · por cada turno que EMPIEZA ese día (primer
//     entrante tras el último saliente confirmado), minutos LABORABLES del
//     horario de la clínica hasta el primer saliente posterior. Mediana; n =
//     turnos contestados. Los turnos sin respuesta no cuentan (no se inventa
//     un tiempo), así que el valor de un día puede bajar cuando llega la
//     respuesta al día siguiente y se recalcula.
//   entrantes / salientes / salientes_del_agente · mensajes del día; los
//     salientes pendientes de confirmar (130) no cuentan.
//   leads_nuevos · leads creados ese día. leads_citados · leads distintos con
//     una cita AGENDADA ese día (citas.lead_id + agendada_en: la fecha real de
//     «citado» es la de la cita, no la del estado). leads_convertidos · leads
//     en Convertido con `fecha_cierre` ese día (MEJORAS 37, cerrada en julio).
//   presupuestos_presentados_n/eur · por `fecha` del presupuesto.
//   aceptados_n/eur · por `fecha_aceptado`. perdidos_n · cambio_estado→PERDIDO
//     del historial, por fecha del cambio.
//   pagos_eur · por `fecha_pago`; la clínica es la del PACIENTE (pagos_paciente
//     no la lleva; pacientes sí). Un pago de un paciente sin clínica solo
//     cuenta en la red.
//   modelo_latencia_mediana_ms · mediana de `latenciaMs` de los turnos del día
//     (solo la llamada al modelo); n = turnos con latencia.
//   evaluaciones / derivaciones / derivaciones_caso_completo / aplazados ·
//     eventos del agente del día; por clínica, la del mensaje evaluado (los
//     eventos sin mensaje_id solo cuentan en la red).
//   coste_usd · suma del coste de cada turno (lib/agente/coste). n = turnos
//     con `usage`. modelo_errores · incidencias agente/modelo_no_disponible
//     (veces). descartes_juez · turnos con borrador descartado por el juez.
//   respuesta_humana_prioritaria_min / respuesta_humana_normal_min (2.5,
//     MEJORAS 180) · por cada ENTREGA del agente (`derivado`) de ese día,
//     minutos LABORABLES hasta el primer saliente CONFIRMADO con
//     autor='persona' del mismo hilo (en modo A, que una persona pulse enviar
//     ES la respuesta humana, aunque el texto lo redactara el agente). La cola
//     se deriva del hecho (colaDeDerivacion: causa + malestar), nunca se lee
//     persistida. Solo cuenta la PRIMERA entrega de cada episodio: otra
//     entrega del mismo hilo sin respuesta humana entre medias es el mismo
//     caso esperando, no uno nuevo. Mediana; n = entregas contestadas. Las
//     entregas sin respuesta NO cuentan (no se inventa un tiempo): el valor
//     de un día puede cambiar cuando llega la respuesta y se recalcula, y lo
//     que sigue esperando se ve en la cola de Inicio, no aquí.

import { sql } from "kysely";
import { DateTime } from "luxon";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { HORARIO_DEFAULT, type HorarioLaboral } from "../automatizaciones/types";
import { minutosLaborablesEntre } from "../seguimiento/tiempo-laborable";
import { costeUsdDeTurno } from "../agente/coste";
import { leerPayloadEvaluacion } from "../agente/persistir-turno";
import { colaDeDerivacion, type CausaDerivacion } from "../automatizacion/estado";
import { TZ_CLINICA } from "../time";

// Las definiciones (métricas, agregación, unidades, sentido, etiquetas) viven
// en `definiciones.ts`, PURO, para que un Client Component pueda importarlas
// sin arrastrar la base al navegador (a583fb1 rompió Vercel por eso; §24).
// Aquí se re-exportan para los lectores de servidor.
export { DEFINICION_V, METRICAS_V1, AGREGACION, UNIDAD, SENTIDO, ETIQUETA_METRICA } from "./definiciones";
export type { Metrica, ValorMetrica, DiaCalculado, Agregacion, Unidad, Sentido } from "./definiciones";
import { DEFINICION_V, METRICAS_V1, type Metrica, type ValorMetrica, type DiaCalculado } from "./definiciones";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function clienteDe(explicito?: Cliente): Cliente {
  const c = explicito ?? currentCliente();
  if (!c) throw new Error("metricas/diarias: sin cliente en contexto");
  return c;
}

export function ayerISO(ahora: Date = new Date()): string {
  return DateTime.fromJSDate(ahora).setZone(TZ_CLINICA).minus({ days: 1 }).toISODate() ?? "";
}

async function horarioDe(clinicaId: string | null): Promise<HorarioLaboral> {
  if (!clinicaId) return HORARIO_DEFAULT;
  try {
    const { conocimientoDeClinica } = await import("../automatizacion/pg");
    return (await conocimientoDeClinica(clinicaId)).plazos.horario ?? HORARIO_DEFAULT;
  } catch (err) {
    console.warn(`[metricas] horario de ${clinicaId} no legible, uso el default:`, err instanceof Error ? err.message : err);
    return HORARIO_DEFAULT;
  }
}

function mediana(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ─── Calcular ────────────────────────────────────────────────────────────────

export async function calcularDia(args: {
  cliente?: Cliente;
  clinicaId: string | null;
  dia: string;
  horario?: HorarioLaboral;
}): Promise<DiaCalculado> {
  const cliente = clienteDe(args.cliente);
  if (!DIA_RE.test(args.dia)) throw new Error(`metricas/diarias: día inválido «${args.dia}»`);
  const c = args.clinicaId;
  const tz = TZ_CLINICA;
  const horario = args.horario ?? (await horarioDe(c));

  return runWithClienteDb(cliente, async (trx) => {
    const out: DiaCalculado = {};

    const msg = await sql<{ entrantes: number; salientes: number; agente: number }>`
      select count(*) filter (where direccion = 'Entrante')::int as entrantes,
             count(*) filter (where direccion = 'Saliente' and coalesce(fuente, '') <> 'Modo_A_manual_pendiente')::int as salientes,
             count(*) filter (where direccion = 'Saliente' and coalesce(fuente, '') <> 'Modo_A_manual_pendiente'
                              and (sugerido_por_ia is true or autor = 'agente'))::int as agente
        from mensajes_whatsapp
       where ("timestamp" at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    const m0 = msg.rows[0];
    out.entrantes = { valor: Number(m0?.entrantes ?? 0), n: Number(m0?.entrantes ?? 0) };
    out.salientes = { valor: Number(m0?.salientes ?? 0), n: Number(m0?.salientes ?? 0) };
    out.salientes_del_agente = { valor: Number(m0?.agente ?? 0), n: Number(m0?.salientes ?? 0) };

    // Turnos que EMPIEZAN ese día: primer entrante tras el último saliente confirmado.
    const turnos = await sql<{ entrante: Date; saliente: Date | null }>`
      select e."timestamp" as entrante,
             (select min(s."timestamp") from mensajes_whatsapp s
               where s.telefono = e.telefono and s.direccion = 'Saliente'
                 and coalesce(s.fuente, '') <> 'Modo_A_manual_pendiente'
                 and s."timestamp" > e."timestamp") as saliente
        from mensajes_whatsapp e
       where e.direccion = 'Entrante' and e.telefono is not null
         and (e."timestamp" at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or e.clinica_id = ${c})
         and not exists (
           select 1 from mensajes_whatsapp p
            where p.telefono = e.telefono and p.direccion = 'Entrante'
              and p."timestamp" < e."timestamp"
              and p."timestamp" > coalesce((
                    select max(s2."timestamp") from mensajes_whatsapp s2
                     where s2.telefono = e.telefono and s2.direccion = 'Saliente'
                       and coalesce(s2.fuente, '') <> 'Modo_A_manual_pendiente'
                       and s2."timestamp" < e."timestamp"), '-infinity'::timestamptz))`.execute(trx);
    const minutos = turnos.rows
      .filter((t) => t.saliente != null)
      .map((t) => minutosLaborablesEntre(new Date(t.entrante), new Date(t.saliente as Date), horario));
    out.tiempo_respuesta_mediana_min = { valor: Math.round(mediana(minutos) * 10) / 10, n: minutos.length };

    const leads = await sql<{ n: number }>`
      select count(*)::int as n from leads
       where (created_at at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    out.leads_nuevos = { valor: Number(leads.rows[0]?.n ?? 0), n: Number(leads.rows[0]?.n ?? 0) };

    const citados = await sql<{ n: number }>`
      select count(distinct lead_id)::int as n from citas
       where lead_id is not null
         and (agendada_en at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    out.leads_citados = { valor: Number(citados.rows[0]?.n ?? 0), n: Number(citados.rows[0]?.n ?? 0) };

    const convertidos = await sql<{ n: number }>`
      select count(*)::int as n from leads
       where estado = 'Convertido' and fecha_cierre is not null
         and (fecha_cierre at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    out.leads_convertidos = { valor: Number(convertidos.rows[0]?.n ?? 0), n: Number(convertidos.rows[0]?.n ?? 0) };

    const pres = await sql<{ pn: number; pe: number; an: number; ae: number }>`
      select count(*) filter (where fecha = ${args.dia}::date)::int as pn,
             coalesce(sum(importe) filter (where fecha = ${args.dia}::date), 0)::float8 as pe,
             count(*) filter (where fecha_aceptado = ${args.dia}::date)::int as an,
             coalesce(sum(importe) filter (where fecha_aceptado = ${args.dia}::date), 0)::float8 as ae
        from presupuestos
       where (${c}::text is null or clinica_id = ${c})`.execute(trx);
    const p0 = pres.rows[0];
    out.presupuestos_presentados_n = { valor: Number(p0?.pn ?? 0), n: Number(p0?.pn ?? 0) };
    out.presupuestos_presentados_eur = { valor: Number(p0?.pe ?? 0), n: Number(p0?.pn ?? 0) };
    out.aceptados_n = { valor: Number(p0?.an ?? 0), n: Number(p0?.an ?? 0) };
    out.aceptados_eur = { valor: Number(p0?.ae ?? 0), n: Number(p0?.an ?? 0) };

    const perd = await sql<{ n: number }>`
      select count(*)::int as n from historial_acciones
       where tipo = 'cambio_estado' and metadata like '%"estadoNuevo":"PERDIDO"%'
         and (fecha at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    out.perdidos_n = { valor: Number(perd.rows[0]?.n ?? 0), n: Number(perd.rows[0]?.n ?? 0) };

    const pagos = await sql<{ n: number; eur: number }>`
      select count(*)::int as n, coalesce(sum(pg.importe), 0)::float8 as eur
        from pagos_paciente pg
        left join pacientes pa on pa.id = pg.paciente_id
       where pg.fecha_pago = ${args.dia}::date
         and (${c}::text is null or pa.clinica_id = ${c})`.execute(trx);
    out.pagos_eur = { valor: Number(pagos.rows[0]?.eur ?? 0), n: Number(pagos.rows[0]?.n ?? 0) };

    // `mensaje_id` del evento es el id de WhatsApp si el mensaje lo tiene y, si
    // no, el id de la fila (barrido-reevaluacion.ts: `waba_message_id ?? id`).
    // El seed no rellena el de WhatsApp: con el join solo por waba, TODAS las
    // métricas del agente por sede daban 0 en DEMO (cazado el 8-sep con 2.5).
    const evs = await sql<{ evento: string; causa: string | null; json: unknown }>`
      select e.evento, e.causa_derivacion as causa, e.evaluacion_json as json
        from eventos_automatizacion e
        left join mensajes_whatsapp m
          on m.waba_message_id = e.mensaje_id or (m.waba_message_id is null and m.id = e.mensaje_id)
       where e.tipo_caso = 'conversacion' and e.evento in ('evaluacion', 'derivado', 'aplazado')
         and (e.created_at at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or m.clinica_id = ${c})`.execute(trx);
    let evaluaciones = 0, derivaciones = 0, casoCompleto = 0, aplazados = 0, coste = 0, conUsage = 0, descartes = 0;
    const latencias: number[] = [];
    for (const e of evs.rows) {
      if (e.evento === "derivado") {
        derivaciones++;
        if ((e.causa ?? "").includes("completo")) casoCompleto++;
        continue;
      }
      if (e.evento === "aplazado") {
        aplazados++;
        continue;
      }
      evaluaciones++;
      // 173: jsonb → objeto (texto solo en filas anteriores a la migración).
      const p = leerPayloadEvaluacion(e.json);
      if (!p) continue;
      const usd = costeUsdDeTurno(p.usage, p.modelo);
      if (usd != null) {
        coste += usd;
        conUsage++;
      }
      if (p.borradorDescartado) descartes++;
      if (typeof p.latenciaMs === "number" && Number.isFinite(p.latenciaMs)) latencias.push(p.latenciaMs);
    }
    out.modelo_latencia_mediana_ms = { valor: Math.round(mediana(latencias)), n: latencias.length };
    out.evaluaciones = { valor: evaluaciones, n: evaluaciones };
    out.derivaciones = { valor: derivaciones, n: derivaciones };
    out.derivaciones_caso_completo = { valor: casoCompleto, n: derivaciones };
    out.aplazados = { valor: aplazados, n: aplazados };
    out.coste_usd = { valor: Math.round(coste * 10000) / 10000, n: conUsage };
    out.descartes_juez = { valor: descartes, n: evaluaciones };

    // 2.5 · Entregas del agente del día → primer saliente confirmado de una
    // persona en el mismo hilo (caso_id = teléfono E.164). Solo la primera
    // entrega de cada episodio: si hay otra entrega anterior del hilo sin
    // respuesta humana entre las dos, esta es el mismo caso esperando.
    const entregas = await sql<{ entregado: Date; causa: string; malestar: boolean | null; respondido: Date | null }>`
      select d.created_at as entregado, d.causa_derivacion as causa, d.malestar,
             (select min(s."timestamp") from mensajes_whatsapp s
               where s.telefono = d.caso_id and s.direccion = 'Saliente' and s.autor = 'persona'
                 and coalesce(s.fuente, '') <> 'Modo_A_manual_pendiente'
                 and s."timestamp" > d.created_at) as respondido
        from eventos_automatizacion d
        left join mensajes_whatsapp m
          on m.waba_message_id = d.mensaje_id or (m.waba_message_id is null and m.id = d.mensaje_id)
       where d.tipo_caso = 'conversacion' and d.evento = 'derivado' and d.causa_derivacion is not null
         and (d.created_at at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or m.clinica_id = ${c})
         and not exists (
           select 1 from eventos_automatizacion d2
            where d2.tipo_caso = 'conversacion' and d2.evento = 'derivado'
              and d2.caso_id = d.caso_id and d2.created_at < d.created_at
              and not exists (
                select 1 from mensajes_whatsapp s2
                 where s2.telefono = d.caso_id and s2.direccion = 'Saliente' and s2.autor = 'persona'
                   and coalesce(s2.fuente, '') <> 'Modo_A_manual_pendiente'
                   and s2."timestamp" > d2.created_at and s2."timestamp" < d.created_at))`.execute(trx);
    const porCola: Record<"prioritaria" | "normal", number[]> = { prioritaria: [], normal: [] };
    for (const e of entregas.rows) {
      if (e.respondido == null) continue;
      const cola = colaDeDerivacion(e.causa as CausaDerivacion, e.malestar);
      porCola[cola].push(minutosLaborablesEntre(new Date(e.entregado), new Date(e.respondido), horario));
    }
    out.respuesta_humana_prioritaria_min = { valor: Math.round(mediana(porCola.prioritaria) * 10) / 10, n: porCola.prioritaria.length };
    out.respuesta_humana_normal_min = { valor: Math.round(mediana(porCola.normal) * 10) / 10, n: porCola.normal.length };

    const modErr = await sql<{ n: number }>`
      select coalesce(sum(veces), 0)::int as n from incidencias
       where tipo = 'agente' and motivo = 'modelo_no_disponible'
         and (hora at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or clinica_id = ${c})`.execute(trx);
    out.modelo_errores = { valor: Number(modErr.rows[0]?.n ?? 0), n: evaluaciones };

    return out;
  });
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

export async function guardarDia(args: {
  cliente?: Cliente;
  clinicaId: string | null;
  dia: string;
  valores: DiaCalculado;
  ahora?: Date;
}): Promise<{ escritas: number }> {
  const cliente = clienteDe(args.cliente);
  const ahora = args.ahora ?? new Date();
  // UNA sentencia por día y alcance (no 21): el backfill vive de ida y vuelta
  // a la base, y cada viaje al pooler son ~100 ms.
  const filas = METRICAS_V1.flatMap((metrica) => {
    const v = args.valores[metrica];
    return v ? [sql`(${cliente}::cliente_t, ${args.clinicaId}, ${args.dia}::date, ${metrica}, ${v.valor}, ${v.n}, ${DEFINICION_V}, ${ahora})`] : [];
  });
  if (filas.length === 0) return { escritas: 0 };
  await runWithClienteDb(cliente, (trx) =>
    sql`
      insert into metricas_diarias (cliente, clinica_id, dia, metrica, valor, n, definicion_v, calculado_en)
      values ${sql.join(filas, sql`, `)}
      on conflict (cliente, (coalesce(clinica_id, '')), dia, metrica)
      do update set valor = excluded.valor, n = excluded.n, definicion_v = excluded.definicion_v, calculado_en = excluded.calculado_en`.execute(trx),
  );
  return { escritas: filas.length };
}

export async function calcularYGuardar(args: { cliente?: Cliente; clinicaId: string | null; dia: string; ahora?: Date; horario?: HorarioLaboral }) {
  const valores = await calcularDia(args);
  const r = await guardarDia({ ...args, valores });
  return { valores, escritas: r.escritas };
}

/** Los horarios de las clínicas, UNA vez por corrida (no uno por día). */
async function horariosDe(clinicas: readonly string[]): Promise<Map<string, HorarioLaboral>> {
  const m = new Map<string, HorarioLaboral>();
  for (const id of clinicas) m.set(id, await horarioDe(id));
  return m;
}

export async function clinicasActivas(cliente?: Cliente): Promise<string[]> {
  const c = clienteDe(cliente);
  const r = await runWithClienteDb(c, (trx) =>
    sql<{ id: string }>`select id from clinicas where activa is not false order by id`.execute(trx),
  );
  return (r.rows ?? []).map((x) => x.id);
}

/** Un día entero de un cliente: la red y cada clínica activa. `clinicas` y
 *  `horarios` se pueden pasar ya cargados (el backfill los carga una vez). */
export async function calcularDiaCliente(args: {
  cliente?: Cliente;
  dia: string;
  ahora?: Date;
  clinicas?: readonly string[];
  horarios?: Map<string, HorarioLaboral>;
}): Promise<{ clinicas: number; escritas: number }> {
  const cliente = clienteDe(args.cliente);
  const clinicas = args.clinicas ?? (await clinicasActivas(cliente));
  const horarios = args.horarios ?? (await horariosDe(clinicas));
  // La red y las clínicas de un mismo día, en paralelo: consultas
  // independientes sobre el pooler.
  const resultados = await Promise.all([
    calcularYGuardar({ cliente, clinicaId: null, dia: args.dia, ahora: args.ahora, horario: HORARIO_DEFAULT }),
    ...clinicas.map((id) => calcularYGuardar({ cliente, clinicaId: id, dia: args.dia, ahora: args.ahora, horario: horarios.get(id) ?? HORARIO_DEFAULT })),
  ]);
  return { clinicas: clinicas.length, escritas: resultados.reduce((s, r) => s + r.escritas, 0) };
}

export function diasEntre(desde: string, hasta: string, tope = 31): string[] {
  if (!DIA_RE.test(desde) || !DIA_RE.test(hasta)) throw new Error("metricas/diarias: rango inválido");
  const out: string[] = [];
  let d = DateTime.fromISO(desde, { zone: TZ_CLINICA });
  const fin = DateTime.fromISO(hasta, { zone: TZ_CLINICA });
  while (d <= fin && out.length < tope) {
    out.push(d.toISODate() ?? "");
    d = d.plus({ days: 1 });
  }
  return out;
}

export async function backfill(args: { cliente?: Cliente; desde: string; hasta: string; tope?: number; ahora?: Date; paralelo?: number }) {
  const cliente = clienteDe(args.cliente);
  const dias = diasEntre(args.desde, args.hasta, args.tope ?? 31);
  const clinicas = await clinicasActivas(cliente);
  const horarios = await horariosDe(clinicas);
  const paralelo = Math.max(1, args.paralelo ?? 3);
  let escritas = 0;
  for (let i = 0; i < dias.length; i += paralelo) {
    const tramo = dias.slice(i, i + paralelo);
    const rs = await Promise.all(tramo.map((dia) => calcularDiaCliente({ cliente, dia, ahora: args.ahora, clinicas, horarios })));
    escritas += rs.reduce((s, r) => s + r.escritas, 0);
  }
  return { dias: dias.length, escritas, truncado: dias.length < diasEntre(args.desde, args.hasta, 100000).length };
}

// ─── Leer ────────────────────────────────────────────────────────────────────

export type PuntoSerie = { dia: string; valor: number; n: number; definicionV: number };

export async function serie(args: {
  cliente?: Cliente;
  clinicaId: string | null;
  metrica: Metrica;
  desde: string;
  hasta: string;
}): Promise<PuntoSerie[]> {
  const cliente = clienteDe(args.cliente);
  if (!DIA_RE.test(args.desde) || !DIA_RE.test(args.hasta)) throw new Error("metricas/diarias: rango inválido");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ dia: string; valor: number; n: number; definicion_v: number }>`
      select dia::text as dia, valor::float8 as valor, n, definicion_v
        from metricas_diarias
       where cliente = ${cliente}::cliente_t
         and coalesce(clinica_id, '') = ${args.clinicaId ?? ""}
         and metrica = ${args.metrica}
         and dia between ${args.desde}::date and ${args.hasta}::date
       order by dia`.execute(trx),
  );
  return (r.rows ?? []).map((x) => ({ dia: x.dia, valor: Number(x.valor), n: Number(x.n), definicionV: Number(x.definicion_v) }));
}
