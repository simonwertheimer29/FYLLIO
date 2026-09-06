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
//   leads_nuevos · leads creados ese día. (leads_citados NO está en v1: nadie
//     registra el cambio de estado con fecha; entrará cuando exista.)
//   presupuestos_presentados_n/eur · por `fecha` del presupuesto.
//   aceptados_n/eur · por `fecha_aceptado`. perdidos_n · cambio_estado→PERDIDO
//     del historial, por fecha del cambio.
//   pagos_eur · SOLO a nivel de red: pagos_paciente no lleva clínica.
//   evaluaciones / derivaciones / derivaciones_caso_completo / aplazados ·
//     eventos del agente del día; por clínica, la del mensaje evaluado (los
//     eventos sin mensaje_id solo cuentan en la red).
//   coste_usd · suma del coste de cada turno (lib/agente/coste). n = turnos
//     con `usage`. modelo_errores · incidencias agente/modelo_no_disponible
//     (veces). descartes_juez · turnos con borrador descartado por el juez.

import { sql } from "kysely";
import { DateTime } from "luxon";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { HORARIO_DEFAULT, type HorarioLaboral } from "../automatizaciones/types";
import { minutosLaborablesEntre } from "../seguimiento/tiempo-laborable";
import { costeUsdDeTurno } from "../agente/coste";
import { TZ_CLINICA } from "../time";

export const DEFINICION_V = 1;

export const METRICAS_V1 = [
  "tiempo_respuesta_mediana_min",
  "entrantes",
  "salientes",
  "salientes_del_agente",
  "leads_nuevos",
  "presupuestos_presentados_n",
  "presupuestos_presentados_eur",
  "aceptados_n",
  "aceptados_eur",
  "perdidos_n",
  "pagos_eur",
  "evaluaciones",
  "derivaciones",
  "derivaciones_caso_completo",
  "aplazados",
  "coste_usd",
  "modelo_errores",
  "descartes_juez",
] as const;
export type Metrica = (typeof METRICAS_V1)[number];
export type ValorMetrica = { valor: number; n: number };
export type DiaCalculado = Partial<Record<Metrica, ValorMetrica>>;

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

    if (c == null) {
      const pagos = await sql<{ n: number; eur: number }>`
        select count(*)::int as n, coalesce(sum(importe), 0)::float8 as eur
          from pagos_paciente where fecha_pago = ${args.dia}::date`.execute(trx);
      out.pagos_eur = { valor: Number(pagos.rows[0]?.eur ?? 0), n: Number(pagos.rows[0]?.n ?? 0) };
    }

    const evs = await sql<{ evento: string; causa: string | null; json: string | null }>`
      select e.evento, e.causa_derivacion as causa, e.evaluacion_json as json
        from eventos_automatizacion e
        left join mensajes_whatsapp m on m.waba_message_id = e.mensaje_id
       where e.tipo_caso = 'conversacion' and e.evento in ('evaluacion', 'derivado', 'aplazado')
         and (e.created_at at time zone ${tz})::date = ${args.dia}::date
         and (${c}::text is null or m.clinica_id = ${c})`.execute(trx);
    let evaluaciones = 0, derivaciones = 0, casoCompleto = 0, aplazados = 0, coste = 0, conUsage = 0, descartes = 0;
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
      if (!e.json) continue;
      try {
        const p = JSON.parse(e.json) as { usage?: Parameters<typeof costeUsdDeTurno>[0]; modelo?: string | null; borradorDescartado?: unknown };
        const usd = costeUsdDeTurno(p.usage, p.modelo);
        if (usd != null) {
          coste += usd;
          conUsage++;
        }
        if (p.borradorDescartado) descartes++;
      } catch {
        /* un json ilegible no cuenta ni rompe el día */
      }
    }
    out.evaluaciones = { valor: evaluaciones, n: evaluaciones };
    out.derivaciones = { valor: derivaciones, n: derivaciones };
    out.derivaciones_caso_completo = { valor: casoCompleto, n: derivaciones };
    out.aplazados = { valor: aplazados, n: aplazados };
    out.coste_usd = { valor: Math.round(coste * 10000) / 10000, n: conUsage };
    out.descartes_juez = { valor: descartes, n: evaluaciones };

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
  return runWithClienteDb(cliente, async (trx) => {
    let escritas = 0;
    for (const metrica of METRICAS_V1) {
      const v = args.valores[metrica];
      if (!v) continue;
      await sql`
        insert into metricas_diarias (cliente, clinica_id, dia, metrica, valor, n, definicion_v, calculado_en)
        values (${cliente}::cliente_t, ${args.clinicaId}, ${args.dia}::date, ${metrica}, ${v.valor}, ${v.n}, ${DEFINICION_V}, ${ahora})
        on conflict (cliente, (coalesce(clinica_id, '')), dia, metrica)
        do update set valor = excluded.valor, n = excluded.n, definicion_v = excluded.definicion_v, calculado_en = excluded.calculado_en`.execute(trx);
      escritas++;
    }
    return { escritas };
  });
}

export async function calcularYGuardar(args: { cliente?: Cliente; clinicaId: string | null; dia: string; ahora?: Date }) {
  const valores = await calcularDia(args);
  const r = await guardarDia({ ...args, valores });
  return { valores, escritas: r.escritas };
}

export async function clinicasActivas(cliente?: Cliente): Promise<string[]> {
  const c = clienteDe(cliente);
  const r = await runWithClienteDb(c, (trx) =>
    sql<{ id: string }>`select id from clinicas where activa is not false order by id`.execute(trx),
  );
  return (r.rows ?? []).map((x) => x.id);
}

/** Un día entero de un cliente: la red y cada clínica activa. */
export async function calcularDiaCliente(args: { cliente?: Cliente; dia: string; ahora?: Date }): Promise<{ clinicas: number; escritas: number }> {
  const cliente = clienteDe(args.cliente);
  const clinicas = await clinicasActivas(cliente);
  let escritas = (await calcularYGuardar({ cliente, clinicaId: null, dia: args.dia, ahora: args.ahora })).escritas;
  for (const id of clinicas) {
    escritas += (await calcularYGuardar({ cliente, clinicaId: id, dia: args.dia, ahora: args.ahora })).escritas;
  }
  return { clinicas: clinicas.length, escritas };
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

export async function backfill(args: { cliente?: Cliente; desde: string; hasta: string; tope?: number; ahora?: Date }) {
  const dias = diasEntre(args.desde, args.hasta, args.tope ?? 31);
  let escritas = 0;
  for (const dia of dias) escritas += (await calcularDiaCliente({ cliente: args.cliente, dia, ahora: args.ahora })).escritas;
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
