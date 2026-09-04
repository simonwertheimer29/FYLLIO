// INICIO (rediseño dictado 31-08) — la capa de datos. Inicio es OPERATIVO:
// cada número cambia lo que alguien hace hoy; lo analítico vive en KPIs.
//
// Cinco bloques, cada uno UNA consulta agregada o una reutilización:
//   0 · desde ayer — desde el último CIERRE DE JORNADA de la clínica (no
//       depende de quién mira ni de cuántas veces entra).
//   1 · dinero parado — las cuatro líneas de riesgo del dashboard, tal cual,
//       + delta vs la FOTO de hace 7 días (035: se guarda, no se deriva).
//   1 · tu equipo — las tres cohortes y el SLA que ya calcula la cola.
//   2 · qué hizo Fyllio este mes — por PROCESO: el resultado y cuánto de eso
//       LLEGÓ COCINADO (una entrega de caso completo del agente, del mismo
//       teléfono y objetivo, en los 30 días anteriores al hecho). Es política
//       y se dice en pantalla: VENTANA_COCINADO_DIAS viaja en el payload.
//   3 · clínicas — la tabla del dashboard, solo en red.
//
// Rendimiento: dashboard (riesgo+clínicas, con la cola en paralelo) ∥ los
// agregados propios ∥ la lectura de fotos. Medido en la ruta.

import { sql } from "kysely";
import { runWithClienteDb, conTransaccionCompartida } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { calcularDashboardRed, type RiesgoItem, type ClinicaFila } from "../dashboard-red";
import { parseConocimiento, plazosParaReloj } from "../agente/conocimiento";
import { HORARIO_DEFAULT } from "../automatizaciones/types";
import { ultimoCierreDeJornada } from "../seguimiento/tiempo-laborable";
import { sumarCosteUsd, type UsageTurno } from "../agente/coste";
import { hoyISO, sumaDias } from "../time";
import type { CasoDeCola, Cohorte } from "../seguimiento/cola";

/** Política dictada (31-08): un hecho «llegó cocinado» si el agente entregó
 *  el caso completo, con ese objetivo, en los 30 días anteriores. Se dice. */
export const VENTANA_COCINADO_DIAS = 30;

export type Proceso = "presupuestos" | "leads" | "cobros" | "citas";

export type Inicio = {
  esRed: boolean;
  generadoEnISO: string;
  desdeAyer: {
    desdeISO: string;
    atendidas: number;
    entregadosListos: number;
    derivadosEsperan: number;
    caducados: number;
  };
  dineroParado: {
    total: number;
    presupuestos: number;
    cobros: number;
    leadsSinImporte: number;
    lineas: Array<RiesgoItem & { delta7d: number | null }>;
    /** Día de la foto con la que se compara; null = aún no hay foto de hace 7 días. */
    comparadoConDia: string | null;
    /** Primera foto guardada (para decir «desde el X» mientras no hay delta). */
    primeraFotoDia: string | null;
  };
  equipo: {
    porCohorte: Record<Cohorte, number>;
    total: number;
    masViejoDias: number | null;
  };
  fyllioMes: {
    mes: string;
    ventanaCocinadoDias: number;
    procesos: Array<{
      proceso: Proceso;
      resultado: number;
      importe: number | null;
      /** null = no se puede saber (citas confirmadas antes de la columna). */
      cocinado: number | null;
      sinDato: number;
    }>;
    detalle: {
      derivacionesPorCausa: Record<string, number>;
      mensajesRedactadosPorAgente: number;
      mensajesDelEquipo: number;
      costeUsd: number | null;
      /** Desde cuándo hay coste medido (primer turno con usage). Se dice. */
      costeDesdeISO: string | null;
      turnosTarifados: number;
      turnosSinTarifa: number;
      aplazadosPorClave: Record<string, number>;
    };
  };
  clinicas: ClinicaFila[] | null;
};

const ORDEN_COHORTES: Cohorte[] = ["necesita_respuesta", "listos_para_cerrar", "fuera_de_plazo"];

export async function calcularInicio(opts: {
  /** null = toda la red. */
  clinicaIds: string[] | null;
  esRed: boolean;
  ahora?: Date;
}): Promise<Inicio> {
  const cliente = requireCliente("calcularInicio");
  const ahora = opts.ahora ?? new Date();
  const hoy = hoyISO(ahora);
  const ids = opts.clinicaIds;

  const [dash, agregados, fotos] = await Promise.all([
    calcularDashboardRed({ clinicaIds: ids, ahora }),
    conTransaccionCompartida(cliente, () => agregadosInicio(cliente, ids, ahora)),
    leerFotos(cliente, ids, opts.esRed, hoy),
  ]);

  // ── 1 · tu equipo, del mismo cálculo de la cola ──
  const casos = (dash.casos ?? []).filter((c) =>
    ids === null ? true : c.clinicaId != null && ids.includes(c.clinicaId),
  );
  const porCohorte = Object.fromEntries(ORDEN_COHORTES.map((c) => [c, 0])) as Record<Cohorte, number>;
  for (const c of casos) porCohorte[c.cohorte]++;

  // ── 1 · dinero parado: las líneas del dashboard + delta vs la foto ──
  const previa = fotos.hace7 ? (JSON.parse(fotos.hace7.riesgo_json) as RiesgoItem[]) : null;
  const lineas = dash.hoy.riesgo.map((r) => {
    const p = previa?.find((x) => x.tipo === r.tipo) ?? null;
    const actual = r.importe ?? r.n;
    const antes = p ? (p.importe ?? p.n) : null;
    return { ...r, delta7d: antes == null ? null : Math.round((actual - antes) * 100) / 100 };
  });

  return {
    esRed: opts.esRed,
    generadoEnISO: ahora.toISOString(),
    desdeAyer: agregados.desdeAyer,
    dineroParado: {
      total: dineroDe(casos, "presupuesto"),
      presupuestos: dineroDe(casos, "presupuesto"),
      cobros: casos.reduce((s, c) => s + (c.cobro?.pendiente ?? 0), 0),
      leadsSinImporte: casos.filter((c) => c.tipo === "lead").length,
      lineas,
      comparadoConDia: fotos.hace7 ? diaISO(fotos.hace7.dia) : null,
      primeraFotoDia: fotos.primera ? diaISO(fotos.primera) : null,
    },
    equipo: {
      porCohorte,
      total: casos.length,
      masViejoDias: casos.length ? Math.max(...casos.map((c) => c.paradoDias)) : null,
    },
    fyllioMes: agregados.fyllioMes,
    clinicas: opts.esRed ? dash.clinicas : null,
  };
}

function dineroDe(casos: CasoDeCola[], tipo: CasoDeCola["tipo"]): number {
  return casos.filter((c) => c.tipo === tipo && c.importe != null).reduce((s, c) => s + (c.importe ?? 0), 0);
}

const diaISO = (d: Date | string) => (d instanceof Date ? hoyISO(d) : String(d).slice(0, 10));

// ── Las FOTOS (035) ─────────────────────────────────────────────────────────

const alcanceDe = (ids: string[] | null, esRed: boolean) => (esRed || ids === null ? "red" : ids.length === 1 ? ids[0] : ids.slice().sort().join("+"));

async function leerFotos(cliente: ReturnType<typeof requireCliente>, ids: string[] | null, esRed: boolean, hoy: string) {
  const alcance = alcanceDe(ids, esRed);
  const objetivo = sumaDias(hoy, -7);
  // UNA consulta (04-09): eran tres selects en su transacción — la mitad del
  // coste era ida y vuelta. La foto de hace 7 días exacta, o la más cercana
  // ANTERIOR dentro de 3 días (un día sin cron no deja el delta en blanco).
  return runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`select
      (select json_build_object('dia', dia, 'riesgo_json', riesgo_json, 'dinero_parado', dinero_parado)
         from inicio_snapshots where alcance = ${alcance} and dia <= ${objetivo}::date and dia >= ${sumaDias(objetivo, -3)}::date
         order by dia desc limit 1) as hace7,
      (select min(dia) from inicio_snapshots where alcance = ${alcance}) as primera,
      exists (select 1 from inicio_snapshots where alcance = ${alcance} and dia = ${hoy}::date) as tiene_de_hoy`.execute(trx);
    const row = r.rows?.[0] ?? {};
    const h = row.hace7 == null ? null : typeof row.hace7 === "string" ? JSON.parse(row.hace7) : row.hace7;
    return {
      hace7: h ? { dia: String(h.dia), riesgo_json: String(h.riesgo_json), dinero_parado: Number(h.dinero_parado) } : null,
      primera: row.primera ?? null,
      tieneDeHoy: Boolean(row.tiene_de_hoy),
    };
  });
}

/** Guarda la foto de HOY del bloque «dinero parado» para un alcance. Idempotente
 *  (upsert por alcance+día): el cron y la lectura on-read pueden coincidir. */
export async function guardarFotoInicio(p: {
  clinicaIds: string[] | null;
  esRed: boolean;
  ahora?: Date;
}): Promise<void> {
  const cliente = requireCliente("guardarFotoInicio");
  const ahora = p.ahora ?? new Date();
  const dash = await calcularDashboardRed({ clinicaIds: p.clinicaIds, ahora });
  const casos = (dash.casos ?? []).filter((c) =>
    p.clinicaIds === null ? true : c.clinicaId != null && p.clinicaIds.includes(c.clinicaId),
  );
  const alcance = alcanceDe(p.clinicaIds, p.esRed);
  await runWithClienteDb(cliente, (trx) =>
    trx
      .insertInto("inicio_snapshots")
      .values({
        cliente,
        alcance,
        dia: hoyISO(ahora) as any,
        riesgo_json: JSON.stringify(dash.hoy.riesgo),
        dinero_parado: dineroDe(casos, "presupuesto"),
      })
      .onConflict((oc) =>
        oc.columns(["cliente", "alcance", "dia"]).doUpdateSet({
          riesgo_json: JSON.stringify(dash.hoy.riesgo),
          dinero_parado: dineroDe(casos, "presupuesto"),
        }),
      )
      .execute(),
  );
}

/** ¿Falta la foto de hoy para este alcance? (para dispararla en after()). */
export async function faltaFotoDeHoy(p: { clinicaIds: string[] | null; esRed: boolean; ahora?: Date }): Promise<boolean> {
  const cliente = requireCliente("faltaFotoDeHoy");
  const f = await leerFotos(cliente, p.clinicaIds, p.esRed, hoyISO(p.ahora ?? new Date()));
  return !f.tieneDeHoy;
}

// ── Los AGREGADOS propios: desde ayer + Fyllio este mes ─────────────────────

async function agregadosInicio(
  cliente: ReturnType<typeof requireCliente>,
  ids: string[] | null,
  ahora: Date,
): Promise<{ desdeAyer: Inicio["desdeAyer"]; fyllioMes: Inicio["fyllioMes"] }> {
  // La ventana de «cocinado» como intervalo literal: es una constante de
  // código (política dictada), no un dato de usuario — sql.raw es legítimo.
  const VENTANA = sql.raw(`interval '${VENTANA_COCINADO_DIAS} days'`);
  return runWithClienteDb(cliente, async (trx) => {
    // El horario de cada clínica visible → su último cierre; en red, el más
    // antiguo de todos (la ventana cubre a todas).
    const cfg: any = await sql`select clinica_id, conocimiento from configuracion_automatizaciones`.execute(trx);
    const horarioDe = (clinicaId: string | null) => {
      const fila = (cfg.rows ?? []).find((r: any) => r.clinica_id === clinicaId) ?? (cfg.rows ?? []).find((r: any) => r.clinica_id == null);
      return plazosParaReloj(parseConocimiento(fila?.conocimiento ?? null)).horario ?? HORARIO_DEFAULT;
    };
    const cierres = (ids ?? [null]).map((cid) => ultimoCierreDeJornada(ahora, horarioDe(cid)));
    const desde = new Date(Math.min(...cierres.map((d) => d.getTime())));
    const scope = ids === null ? sql`true` : sql`m.clinica_id = any(${ids}::text[])`;
    const enScope = (alias: string) =>
      ids === null
        ? sql`true`
        : sql`exists (select 1 from mensajes_whatsapp m where m.telefono = ${sql.ref(alias + ".caso_id")} and ${scope})`;

    const r: any = await sql`select
      -- ── 0 · desde ayer ──
      (select count(distinct e.caso_id) from eventos_automatizacion e
         where e.evento = 'evaluacion' and e.created_at >= ${desde} and ${enScope("e")})::int as atendidas,
      (select count(*) from eventos_automatizacion e
         where e.evento = 'derivado' and e.causa_derivacion = 'caso_completo' and e.created_at >= ${desde} and ${enScope("e")})::int as entregados_listos,
      (select count(*) from eventos_automatizacion e
         where e.evento = 'derivado' and e.causa_derivacion <> 'caso_completo' and e.created_at >= ${desde} and ${enScope("e")}
           and not exists (select 1 from eventos_automatizacion r where r.caso_id = e.caso_id and r.evento = 'resuelto_manual' and r.created_at > e.created_at))::int as derivados_esperan,
      (select count(*) from cola_envios c
         where c.estado = 'Caducado' and c.programado_para >= ${desde}
           and (${ids === null ? sql`true` : sql`exists (select 1 from presupuestos p where p.id = c.presupuesto_ref and p.clinica_id = any(${ids}::text[]))`}))::int as caducados,
      -- ── 2 · este mes, por proceso: resultado + cocinado ──
      (select json_build_object('n', count(*), 'importe', coalesce(sum(p.importe), 0), 'cocinado', count(*) filter (where coc))
         from (select p.importe,
                      exists (select 1 from eventos_automatizacion e where e.evento = 'derivado' and e.causa_derivacion = 'caso_completo' and e.objetivo_activo = 'presupuesto'
                                and regexp_replace(e.caso_id, '[^0-9]', '', 'g') = regexp_replace(coalesce(p.paciente_telefono, pa.telefono, ''), '[^0-9]', '', 'g')
                                and e.created_at <= p.fecha_aceptado::timestamptz + interval '1 day' and e.created_at >= p.fecha_aceptado::timestamptz - ${VENTANA}) as coc
                 from presupuestos p left join pacientes pa on pa.id = p.paciente_id
                where p.estado = 'ACEPTADO'
                  and p.fecha_aceptado >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid'))::date
                  and (${ids === null ? sql`true` : sql`p.clinica_id = any(${ids}::text[])`})) p) as presupuestos,
      (select json_build_object('n', count(*), 'cocinado', count(*) filter (where coc))
         from (select exists (select 1 from eventos_automatizacion e where e.evento = 'derivado' and e.causa_derivacion = 'caso_completo' and e.objetivo_activo = 'cita'
                                and regexp_replace(e.caso_id, '[^0-9]', '', 'g') = regexp_replace(coalesce(l.telefono, ''), '[^0-9]', '', 'g')
                                and e.created_at <= (l.fecha_cita::date)::timestamptz + interval '1 day' and e.created_at >= (l.fecha_cita::date)::timestamptz - ${VENTANA}) as coc
                 from leads l
                where l.estado in ('Citado', 'Citados Hoy') and l.fecha_cita is not null
                  and l.fecha_cita::date >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid'))::date
                  and (${ids === null ? sql`true` : sql`l.clinica_id = any(${ids}::text[])`})) l) as leads,
      (select json_build_object('n', count(*), 'importe', coalesce(sum(g.importe), 0), 'cocinado', count(*) filter (where coc))
         from (select g.importe,
                      exists (select 1 from eventos_automatizacion e where e.evento = 'derivado' and e.causa_derivacion = 'caso_completo' and e.objetivo_activo = 'cobro'
                                and regexp_replace(e.caso_id, '[^0-9]', '', 'g') = regexp_replace(coalesce(pa.telefono, ''), '[^0-9]', '', 'g')
                                and e.created_at <= g.fecha_pago::timestamptz + interval '1 day' and e.created_at >= g.fecha_pago::timestamptz - ${VENTANA}) as coc
                 from pagos_paciente g join pacientes pa on pa.id = g.paciente_id
                where g.fecha_pago >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid'))::date
                  and (${ids === null ? sql`true` : sql`pa.clinica_id = any(${ids}::text[])`})) g) as cobros,
      (select json_build_object('n', count(*), 'cocinado', count(*) filter (where c.confirmada_por in ('agente_voz', 'recordatorio')), 'sin_dato', count(*) filter (where c.confirmada_por is null))
         from citas c
        where c.estado = 'Confirmada'
          and c.hora_inicio >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid'
          and (${ids === null ? sql`true` : sql`c.clinica_id = any(${ids}::text[])`})) as citas,
      -- ── 2 · el detalle expandido ──
      (select json_agg(json_build_object('causa', causa_derivacion, 'n', n)) from (
         select e.causa_derivacion, count(*)::int n from eventos_automatizacion e
          where e.evento = 'derivado' and e.created_at >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid' and ${enScope("e")}
          group by 1) x) as derivaciones,
      (select json_agg(json_build_object('clave', clave_aplazado, 'n', n)) from (
         select e.clave_aplazado, count(*)::int n from eventos_automatizacion e
          where e.evento = 'aplazado' and e.created_at >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid' and ${enScope("e")}
          group by 1) x) as aplazados,
      (select json_build_object('agente', count(*) filter (where sugerido_por_ia = true), 'equipo', count(*) filter (where sugerido_por_ia is distinct from true))
         from mensajes_whatsapp m
        where m.direccion = 'Saliente' and m."timestamp" >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid' and ${scope}) as mensajes,
      (select json_agg(json_build_object('usage', (e.evaluacion_json::jsonb)->'usage', 'modelo', (e.evaluacion_json::jsonb)->>'modelo'))
         from eventos_automatizacion e
        where e.evento = 'evaluacion' and e.created_at >= date_trunc('month', (${ahora}::timestamptz at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid' and ${enScope("e")}) as turnos,
      (select min(e.created_at) from eventos_automatizacion e
        where e.evento = 'evaluacion' and e.evaluacion_json like '%"usage"%') as coste_desde
    `.execute(trx);
    const row = r.rows?.[0] ?? {};
    const num = (v: unknown) => Number(v ?? 0);
    const j = (v: unknown): any => (v == null ? {} : typeof v === "string" ? JSON.parse(v) : v);
    const pres = j(row.presupuestos), leads = j(row.leads), cob = j(row.cobros), cit = j(row.citas);
    const turnos: Array<{ usage: UsageTurno | null; modelo: string | null }> = (row.turnos ?? []) as any;
    const coste = sumarCosteUsd(turnos.map((t) => ({ usage: t.usage, modelo: t.modelo })));
    const mesISO = hoyISO(ahora).slice(0, 7);
    return {
      desdeAyer: {
        desdeISO: desde.toISOString(),
        atendidas: num(row.atendidas),
        entregadosListos: num(row.entregados_listos),
        derivadosEsperan: num(row.derivados_esperan),
        caducados: num(row.caducados),
      },
      fyllioMes: {
        mes: mesISO,
        ventanaCocinadoDias: VENTANA_COCINADO_DIAS,
        procesos: [
          { proceso: "presupuestos", resultado: num(pres.n), importe: num(pres.importe), cocinado: num(pres.cocinado), sinDato: 0 },
          { proceso: "leads", resultado: num(leads.n), importe: null, cocinado: num(leads.cocinado), sinDato: 0 },
          { proceso: "cobros", resultado: num(cob.n), importe: num(cob.importe), cocinado: num(cob.cocinado), sinDato: 0 },
          // Citas: sin la columna (034) no se sabe quién confirmó — si TODAS
          // son sin dato, el cocinado es null, no cero.
          { proceso: "citas", resultado: num(cit.n), importe: null, cocinado: num(cit.n) > 0 && num(cit.sin_dato) === num(cit.n) ? null : num(cit.cocinado), sinDato: num(cit.sin_dato) },
        ],
        detalle: {
          derivacionesPorCausa: Object.fromEntries(((row.derivaciones ?? []) as any[]).map((x) => [x.causa, Number(x.n)])),
          aplazadosPorClave: Object.fromEntries(((row.aplazados ?? []) as any[]).map((x) => [x.clave, Number(x.n)])),
          mensajesRedactadosPorAgente: num(j(row.mensajes).agente),
          mensajesDelEquipo: num(j(row.mensajes).equipo),
          costeUsd: coste.turnos - coste.sinTarifa > 0 ? coste.usd : null,
          costeDesdeISO: row.coste_desde ? new Date(row.coste_desde).toISOString() : null,
          turnosTarifados: coste.turnos - coste.sinTarifa,
          turnosSinTarifa: coste.sinTarifa,
        },
      },
    };
  });
}
