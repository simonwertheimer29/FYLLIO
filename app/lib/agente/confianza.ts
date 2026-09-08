// app/lib/agente/confianza.ts
//
// LA CONFIANZA EN EL AGENTE, la capa de datos (plan maestro 2.4, MEJORAS
// 179/184/185). Todo sale de lo ya persistido: ni una llamada al modelo.
//
//   · la VARA: `evals/ultima-pasada.json` (la escribe qa:evals-evaluador al
//     terminar una pasada ENTERA) puesta al lado del hash del prompt que corre
//     HOY (168). Si difieren, la vara es de otra versión y se dice.
//   · por CLÍNICA, en días completos hasta ayer: turnos evaluados, entregas y
//     cuántas con el caso listo, qué sigue exigiendo persona (causas), qué
//     aplazó (claves), descartes del control, la coincidencia agente-humano
//     (envíos medidos con `distancia_edicion`) y los turnos marcados «se
//     equivocó» (2.7).
//
// La sede de un evento de conversación es la del hilo (último mensaje con
// clínica), como en Inicio y en el panel de descartes; la de un envío sigue
// `sqlClinicaDeEnvio`, compartida con la serie diaria. Los hilos sin sede solo
// los ve la red: no se reparten ni se inventan (§4).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO, sumaDias, TZ_CLINICA } from "../time";
import { resumirCoincidencia } from "../automatizacion/coincidencia";
import { sqlClinicaDeEnvio } from "../automatizacion/clinica-de-envio";
import { hashVersion } from "./version";
import { SYSTEM_PROMPT_EVALUADOR } from "./evaluador";
import { SYSTEM_PROMPT_JUEZ } from "./juez-borrador";
import ultimaPasada from "../../../evals/ultima-pasada.json";
import {
  CONFIANZA_DIAS,
  type ClinicaConfianza,
  type CoincidenciaVentana,
  type Confianza,
  type Vara,
  type VaraHoy,
} from "./confianza.tipos";

export * from "./confianza.tipos";

// ─── La vara ─────────────────────────────────────────────────────────────────

let avisadoVaraIlegible = false;

/** Lee el JSON con las manos: es nuestro, pero una vara ilegible tiene que
 *  verse como «sin vara legible», no como un número inventado ni un crash. */
export function leerVara(x: unknown): Vara | null {
  const o = x as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const par = (v: unknown, a: string, b: string): { [k: string]: number } | null => {
    const p = v as Record<string, unknown> | null;
    const na = p ? num(p[a]) : null;
    const nb = p ? num(p[b]) : null;
    return na == null || nb == null ? null : { [a]: na, [b]: nb };
  };
  const ver = o?.version as Record<string, unknown> | undefined;
  const decision = par(o?.decision, "aciertos", "total") as Vara["decision"] | null;
  const descartes = par(o?.descartesJuez, "n", "total") as Vara["descartesJuez"] | null;
  const etiquetas = par(o?.etiquetasFueraVocabulario, "n", "turnos") as Vara["etiquetasFueraVocabulario"] | null;
  const origen = o?.origen;
  if (
    !o || typeof o.fecha !== "string" || typeof o.modelo !== "string" ||
    (origen !== "sintetico" && origen !== "real" && origen !== "mixto") ||
    num(o.casos) == null || num(o.turnos) == null || !decision || !descartes || !etiquetas ||
    typeof ver?.evaluador !== "string" || typeof ver?.juez !== "string"
  ) {
    if (!avisadoVaraIlegible) {
      avisadoVaraIlegible = true;
      console.error("[agente/confianza] evals/ultima-pasada.json ilegible: la vara no se enseña");
    }
    return null;
  }
  return {
    fecha: o.fecha,
    modelo: o.modelo,
    origen,
    casos: num(o.casos)!,
    turnos: num(o.turnos)!,
    decision,
    listo: (par(o.listo, "aciertos", "total") as Vara["listo"]) ?? null,
    descartesJuez: descartes,
    etiquetasFueraVocabulario: etiquetas,
    costePorTurnoUsd: num(o.costePorTurnoUsd),
    version: { evaluador: ver.evaluador, juez: ver.juez },
    fallos: Array.isArray(o.fallos) ? o.fallos.filter((f): f is string => typeof f === "string") : [],
    salida: typeof o.salida === "string" ? o.salida : null,
  };
}

/** La vara al lado de lo que corre hoy. */
export function varaHoy(): VaraHoy | null {
  const pasada = leerVara(ultimaPasada);
  if (!pasada) return null;
  const hoy = { evaluador: hashVersion(SYSTEM_PROMPT_EVALUADOR), juez: hashVersion(SYSTEM_PROMPT_JUEZ) };
  return { pasada, hoy, mideLoQueCorre: pasada.version.evaluador === hoy.evaluador && pasada.version.juez === hoy.juez };
}

// ─── La ventana ──────────────────────────────────────────────────────────────

export function ventanaConfianza(ahora: Date, dias = CONFIANZA_DIAS): { desde: string; hasta: string; hoy: string; dias: number } {
  const hoy = hoyISO(ahora);
  const hasta = sumaDias(hoy, -1);
  return { desde: sumaDias(hasta, -(dias - 1)), hasta, hoy, dias };
}

type Alcance = { cliente: ReturnType<typeof requireCliente>; clinicaIds: string[] | null; ahora: Date; dias?: number };

/** Un id de sede es visible si el alcance es la red o lo incluye. Sin sede →
 *  solo la red. */
const visible = (ids: string[] | null, clinicaId: string | null) =>
  ids === null ? true : clinicaId != null && ids.includes(clinicaId);

type FilaJson = Record<string, unknown>;
const j = (v: unknown): FilaJson[] => (v == null ? [] : typeof v === "string" ? (JSON.parse(v) as FilaJson[]) : (v as FilaJson[]));

// ─── La coincidencia (la usa también Inicio › Tu equipo) ────────────────────

/** Envíos medidos por sede en la ventana, más los envíos del equipo (el
 *  denominador entero). Devuelve por sede para que el bloque de confianza y
 *  el agregado salgan del MISMO dato. */
export async function enviosPorClinica(a: Alcance): Promise<{
  ventana: ReturnType<typeof ventanaConfianza>;
  porClinica: Map<string | null, { distancias: number[]; enviosDelEquipo: number }>;
}> {
  const v = ventanaConfianza(a.ahora, a.dias);
  const tz = TZ_CLINICA;
  const r = await runWithClienteDb(a.cliente, (trx) =>
    sql<{ envios: unknown; equipo: unknown }>`
      select
        (select json_agg(json_build_object('clinica_id', x.clinica_id, 'd', x.d)) from (
           select ${sqlClinicaDeEnvio("e")} as clinica_id, e.distancia_edicion::float8 as d
             from eventos_automatizacion e
            where e.evento = 'mensaje_enviado' and e.distancia_edicion is not null
              and e.created_at >= (${v.desde}::date::timestamp at time zone ${tz})
              and e.created_at <  (${v.hoy}::date::timestamp at time zone ${tz})) x) as envios,
        (select json_agg(json_build_object('clinica_id', m.clinica_id, 'n', m.n)) from (
           select clinica_id, count(*)::int as n
             from mensajes_whatsapp
            where direccion = 'Saliente' and autor = 'persona'
              and coalesce(fuente, '') <> 'Modo_A_manual_pendiente'
              and "timestamp" >= (${v.desde}::date::timestamp at time zone ${tz})
              and "timestamp" <  (${v.hoy}::date::timestamp at time zone ${tz})
            group by 1) m) as equipo`.execute(trx),
  );
  const row = r.rows[0];
  const porClinica = new Map<string | null, { distancias: number[]; enviosDelEquipo: number }>();
  const de = (id: unknown) => {
    const k = id == null ? null : String(id);
    if (!porClinica.has(k)) porClinica.set(k, { distancias: [], enviosDelEquipo: 0 });
    return porClinica.get(k)!;
  };
  for (const x of j(row?.envios)) {
    const d = Number(x.d);
    if (Number.isFinite(d)) de(x.clinica_id).distancias.push(d);
  }
  for (const x of j(row?.equipo)) de(x.clinica_id).enviosDelEquipo += Number(x.n) || 0;
  return { ventana: v, porClinica };
}

/** La coincidencia del alcance, agregada: Inicio › Tu equipo (185). */
export async function coincidenciaDe(a: Alcance): Promise<CoincidenciaVentana> {
  const { ventana, porClinica } = await enviosPorClinica(a);
  const distancias: number[] = [];
  let enviosDelEquipo = 0;
  for (const [id, x] of porClinica) {
    if (!visible(a.clinicaIds, id)) continue;
    distancias.push(...x.distancias);
    enviosDelEquipo += x.enviosDelEquipo;
  }
  return { ...resumirCoincidencia(distancias), desde: ventana.desde, hasta: ventana.hasta, dias: ventana.dias, enviosDelEquipo };
}

// ─── El bloque entero ────────────────────────────────────────────────────────

const filaVacia = (clinicaId: string | null, nombre: string | null, v: ReturnType<typeof ventanaConfianza>): ClinicaConfianza => ({
  clinicaId,
  nombre,
  turnos: 0,
  entregas: 0,
  entregasListas: 0,
  exigenPersona: {},
  aplazados: {},
  descartes: 0,
  coincidencia: { ...resumirCoincidencia([]), desde: v.desde, hasta: v.hasta, dias: v.dias, enviosDelEquipo: 0 },
  marcados: { total: 0, pendientes: 0, aceptados: 0, descartados: 0 },
});

const sumaRec = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};

export async function confianzaDe(a: Alcance): Promise<Confianza> {
  const v = ventanaConfianza(a.ahora, a.dias);
  const tz = TZ_CLINICA;
  const cliente = a.cliente;

  const [envios, r] = await Promise.all([
    enviosPorClinica(a),
    runWithClienteDb(cliente, (trx) =>
      sql<{ eventos: unknown; marcados: unknown; clinicas: unknown }>`
        with cl as (
          select telefono,
                 (array_agg(clinica_id order by "timestamp" desc) filter (where clinica_id is not null))[1] as clinica_id
            from mensajes_whatsapp
           where telefono is not null and "timestamp" is not null
           group by telefono
        ),
        ev as (
          select cl.clinica_id, e.evento,
                 case e.evento
                   when 'derivado' then coalesce(e.causa_derivacion, '')
                   when 'aplazado' then coalesce(e.clave_aplazado, '')
                   when 'evaluacion' then case
                     when e.evaluacion_json is not null and jsonb_typeof(e.evaluacion_json) = 'object'
                          and coalesce(e.evaluacion_json -> 'borradorDescartado' ->> 'motivo', '') <> '' then 'descartado'
                     else '' end
                   else '' end as clave
            from eventos_automatizacion e
            left join cl on cl.telefono = e.caso_id
           where e.tipo_caso = 'conversacion' and e.evento in ('evaluacion', 'derivado', 'aplazado')
             and e.created_at >= (${v.desde}::date::timestamp at time zone ${tz})
             and e.created_at <  (${v.hoy}::date::timestamp at time zone ${tz})
        )
        select
          (select json_agg(json_build_object('clinica_id', x.clinica_id, 'evento', x.evento, 'clave', x.clave, 'n', x.n)) from (
             select clinica_id, evento, clave, count(*)::int as n from ev group by 1, 2, 3) x) as eventos,
          (select json_agg(json_build_object('clinica_id', x.clinica_id, 'estado', x.estado, 'n', x.n)) from (
             select clinica_id, estado, count(*)::int as n
               from casos_candidatos_eval
              where marcado_en >= (${v.desde}::date::timestamp at time zone ${tz})
                and marcado_en <  (${v.hoy}::date::timestamp at time zone ${tz})
              group by 1, 2) x) as marcados,
          (select json_agg(json_build_object('id', c.id, 'nombre', c.nombre)) from clinicas c where c.cliente = ${cliente}) as clinicas`.execute(trx),
    ),
  ]);
  const row = r.rows[0];
  const nombreDe = new Map<string, string | null>(j(row?.clinicas).map((c) => [String(c.id), c.nombre == null ? null : String(c.nombre)]));

  const filas = new Map<string | null, ClinicaConfianza>();
  const fila = (id: unknown) => {
    const k = id == null ? null : String(id);
    if (!filas.has(k)) filas.set(k, filaVacia(k, k == null ? null : (nombreDe.get(k) ?? null), v));
    return filas.get(k)!;
  };

  for (const x of j(row?.eventos)) {
    const f = fila(x.clinica_id);
    const n = Number(x.n) || 0;
    const clave = String(x.clave ?? "");
    if (x.evento === "evaluacion") {
      f.turnos += n;
      if (clave === "descartado") f.descartes += n;
    } else if (x.evento === "derivado") {
      f.entregas += n;
      if (clave === "caso_completo") f.entregasListas += n;
      else f.exigenPersona[clave || "sin_causa"] = (f.exigenPersona[clave || "sin_causa"] ?? 0) + n;
    } else if (x.evento === "aplazado") {
      f.aplazados[clave || "sin_clave"] = (f.aplazados[clave || "sin_clave"] ?? 0) + n;
    }
  }
  for (const x of j(row?.marcados)) {
    const f = fila(x.clinica_id);
    const n = Number(x.n) || 0;
    f.marcados.total += n;
    const estado = String(x.estado);
    if (estado === "pendiente") f.marcados.pendientes += n;
    else if (estado === "aceptado") f.marcados.aceptados += n;
    else if (estado === "descartado") f.marcados.descartados += n;
  }
  for (const [id, x] of envios.porClinica) {
    const f = fila(id);
    f.coincidencia = { ...resumirCoincidencia(x.distancias), desde: v.desde, hasta: v.hasta, dias: v.dias, enviosDelEquipo: x.enviosDelEquipo };
  }

  // Aislamiento (§5): fuera del alcance, fuera del payload — no «a cero».
  const clinicas = [...filas.values()]
    .filter((f) => visible(a.clinicaIds, f.clinicaId))
    .sort((x, y) => y.turnos - x.turnos || (x.nombre ?? "").localeCompare(y.nombre ?? ""));

  // El agregado se recalcula desde las DISTANCIAS (la tasa no se promedia).
  const total = filaVacia(null, null, v);
  const distancias: number[] = [];
  for (const f of clinicas) {
    total.turnos += f.turnos;
    total.entregas += f.entregas;
    total.entregasListas += f.entregasListas;
    total.exigenPersona = sumaRec(total.exigenPersona, f.exigenPersona);
    total.aplazados = sumaRec(total.aplazados, f.aplazados);
    total.descartes += f.descartes;
    total.marcados.total += f.marcados.total;
    total.marcados.pendientes += f.marcados.pendientes;
    total.marcados.aceptados += f.marcados.aceptados;
    total.marcados.descartados += f.marcados.descartados;
    total.coincidencia.enviosDelEquipo += f.coincidencia.enviosDelEquipo;
    const x = envios.porClinica.get(f.clinicaId);
    if (x) distancias.push(...x.distancias);
  }
  total.coincidencia = { ...total.coincidencia, ...resumirCoincidencia(distancias) };

  return { desde: v.desde, hasta: v.hasta, dias: v.dias, vara: varaHoy(), clinicas, total };
}
