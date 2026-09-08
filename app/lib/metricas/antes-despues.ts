// app/lib/metricas/antes-despues.ts
//
// LA COMPARACIÓN CONTRA UNO MISMO (plan maestro 2.6, MEJORAS 181). «Aceptaba
// el 40 % y ahora el 52 % desde el día X», con n, ventana igual y aviso de no
// causalidad. Lee de `metricas_diarias` (172); la marca sale del historial de
// configuración (167) o la pone la persona.
//
// Reglas, para que no mienta:
//   · Ventana IGUAL: los mismos días antes y después de la marca (la marca
//     no cuenta en ninguna). Si aún no han pasado `dias` completos, las DOS
//     ventanas se acortan a los disponibles — nunca 14 días contra 3.
//   · Último día completo = ayer (día de la clínica). Hoy no entra.
//   · Cada valor lleva su n y sus días con dato; sin dato suficiente no hay
//     comparación, hay «no comparable» con el motivo.
//   · Si la definición (definicion_v) cambió entre las dos ventanas, no se
//     compara: peras con manzanas.
//   · El aviso de no causalidad va SIEMPRE con el resultado.

import { DateTime } from "luxon";
import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { AGREGACION, METRICAS_V1, N_MIN_MEDIANA, type Metrica } from "./definiciones";
import { TZ_CLINICA } from "../time";

export const AVISO_NO_CAUSAL =
  "Antes y después no es causa y efecto: en la ventana de después cambiaron también otras cosas (temporada, personal, campañas). Sirve para mirar, no para concluir.";
/** Mínimo de casos detrás de una mediana ponderada para compararla. Vive en
 *  `definiciones` (puro) porque Inicio, en el cliente, avisa con el mismo umbral. */
export { N_MIN_MEDIANA };
export const VENTANAS_PERMITIDAS = [7, 14, 28] as const;

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Ventana = {
  desde: string;
  hasta: string;
  dias: number;
  diasConDato: number;
  valor: number | null;
  n: number;
};

export type Comparacion = {
  metrica: Metrica;
  agregacion: "suma" | "mediana_ponderada";
  antes: Ventana;
  despues: Ventana;
  delta: number | null;
  deltaPct: number | null;
  comparable: boolean;
  motivo: string | null;
  definicionV: number | null;
};

export type Hito = {
  dia: string;
  campo: string;
  etiqueta: string;
  antes: string | null;
  despues: string | null;
  actor: string | null;
};

function clienteDe(explicito?: Cliente): Cliente {
  const c = explicito ?? currentCliente();
  if (!c) throw new Error("metricas/antes-despues: sin cliente en contexto");
  return c;
}

export function hoyISO(ahora: Date = new Date()): string {
  return DateTime.fromJSDate(ahora).setZone(TZ_CLINICA).toISODate() ?? "";
}

/** Las dos ventanas, iguales, alrededor de la marca. `null` si no hay ni un
 *  día completo después de la marca. */
export function ventanasIguales(
  marca: string,
  dias: number,
  hoy: string,
): { d: number; antes: { desde: string; hasta: string }; despues: { desde: string; hasta: string } } | null {
  if (!DIA_RE.test(marca) || !DIA_RE.test(hoy) || !Number.isFinite(dias) || dias < 1) return null;
  const m = DateTime.fromISO(marca, { zone: TZ_CLINICA });
  const ayer = DateTime.fromISO(hoy, { zone: TZ_CLINICA }).minus({ days: 1 });
  const disponibles = Math.floor(ayer.diff(m, "days").days);
  const d = Math.min(Math.floor(dias), disponibles);
  if (d < 1) return null;
  return {
    d,
    antes: { desde: m.minus({ days: d }).toISODate() ?? "", hasta: m.minus({ days: 1 }).toISODate() ?? "" },
    despues: { desde: m.plus({ days: 1 }).toISODate() ?? "", hasta: m.plus({ days: d }).toISODate() ?? "" },
  };
}

type Fila = { dia: string; metrica: string; valor: number; n: number; definicion_v: number };

function agregar(filas: Fila[], metrica: Metrica, desde: string, hasta: string, d: number): Ventana {
  const propias = filas.filter((f) => f.metrica === metrica && f.dia >= desde && f.dia <= hasta);
  const n = propias.reduce((s, f) => s + Number(f.n), 0);
  let valor: number | null = null;
  if (propias.length) {
    if (AGREGACION[metrica] === "suma") valor = propias.reduce((s, f) => s + Number(f.valor), 0);
    else valor = n > 0 ? propias.reduce((s, f) => s + Number(f.valor) * Number(f.n), 0) / n : null;
  }
  return { desde, hasta, dias: d, diasConDato: propias.length, valor: valor == null ? null : Math.round(valor * 100) / 100, n };
}

export function compararFilas(filas: Fila[], marca: string, dias: number, hoy: string): { d: number; comparaciones: Comparacion[] } | null {
  const v = ventanasIguales(marca, dias, hoy);
  if (!v) return null;
  const minDias = Math.max(1, Math.ceil(v.d / 2));
  const comparaciones: Comparacion[] = METRICAS_V1.map((metrica) => {
    const antes = agregar(filas, metrica, v.antes.desde, v.antes.hasta, v.d);
    const despues = agregar(filas, metrica, v.despues.desde, v.despues.hasta, v.d);
    const versiones = new Set(
      filas.filter((f) => f.metrica === metrica && f.dia >= v.antes.desde && f.dia <= v.despues.hasta).map((f) => Number(f.definicion_v)),
    );
    const agregacion = AGREGACION[metrica];
    let motivo: string | null = null;
    if (versiones.size > 1) motivo = "la definición de la métrica cambió entre las dos ventanas";
    else if (antes.diasConDato < minDias || despues.diasConDato < minDias) motivo = `faltan días con dato (mínimo ${minDias} de ${v.d} en cada ventana)`;
    else if (agregacion === "mediana_ponderada" && (antes.n < N_MIN_MEDIANA || despues.n < N_MIN_MEDIANA)) motivo = `pocos casos para una mediana (mínimo ${N_MIN_MEDIANA} en cada ventana)`;
    else if (antes.valor == null || despues.valor == null) motivo = "sin valor en una de las ventanas";
    const comparable = motivo == null;
    const delta = comparable && antes.valor != null && despues.valor != null ? Math.round((despues.valor - antes.valor) * 100) / 100 : null;
    const deltaPct = comparable && delta != null && antes.valor != null && antes.valor !== 0 ? Math.round((delta / Math.abs(antes.valor)) * 1000) / 10 : null;
    return {
      metrica,
      agregacion,
      antes,
      despues,
      delta,
      deltaPct,
      comparable,
      motivo,
      definicionV: versiones.size === 1 ? [...versiones][0]! : null,
    };
  });
  return { d: v.d, comparaciones };
}

export async function compararTodas(args: {
  cliente?: Cliente;
  clinicaId: string | null;
  marca: string;
  dias?: number;
  hoy?: string;
}): Promise<{ marca: string; dias: number; d: number; comparaciones: Comparacion[]; aviso: string } | null> {
  const cliente = clienteDe(args.cliente);
  const dias = args.dias ?? 14;
  const hoy = args.hoy ?? hoyISO();
  const v = ventanasIguales(args.marca, dias, hoy);
  if (!v) return null;
  const filas = await runWithClienteDb(cliente, (trx) =>
    sql<Fila>`
      select dia::text as dia, metrica, valor::float8 as valor, n, definicion_v
        from metricas_diarias
       where cliente = ${cliente}::cliente_t
         and coalesce(clinica_id, '') = ${args.clinicaId ?? ""}
         and dia between ${v.antes.desde}::date and ${v.despues.hasta}::date`.execute(trx),
  );
  const r = compararFilas(filas.rows ?? [], args.marca, dias, hoy);
  if (!r) return null;
  return { marca: args.marca, dias, d: r.d, comparaciones: r.comparaciones, aviso: AVISO_NO_CAUSAL };
}

// ─── Hitos: las marcas que da el historial de configuración (167) ────────────

const ETIQUETA_CAMPO: Readonly<Record<string, (antes: string | null, despues: string | null) => string>> = {
  evaluador_activo: (_a, d) => (d === "true" ? "Agente encendido" : d === "false" ? "Agente apagado" : "Interruptor del agente cambiado"),
  activa: (_a, d) => (d === "true" ? "Automatizaciones activadas" : d === "false" ? "Automatizaciones desactivadas" : "Automatizaciones cambiadas"),
  objetivos: () => "Objetivos del agente cambiados",
  conocimiento: () => "Conocimiento de la clínica actualizado",
  toques_antes_de_agotar: (a, d) => `Cadencia cambiada (${a ?? "?"} → ${d ?? "?"} toques)`,
  modo_whatsapp: (a, d) => `Modo de WhatsApp cambiado (${a ?? "?"} → ${d ?? "?"})`,
};

export function etiquetaHito(tabla: string, campo: string, antes: string | null, despues: string | null): string {
  const f = ETIQUETA_CAMPO[campo];
  return f ? f(antes, despues) : `${tabla}.${campo} cambiado`;
}

export async function hitos(args: { cliente?: Cliente; clinicaId: string | null; limite?: number }): Promise<Hito[]> {
  const cliente = clienteDe(args.cliente);
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ dia: string; tabla: string; campo: string; antes: string | null; despues: string | null; actor: string | null }>`
      select (created_at at time zone ${TZ_CLINICA})::date::text as dia, tabla, campo,
             (array_agg(antes order by created_at asc))[1] as antes,
             (array_agg(despues order by created_at desc))[1] as despues,
             (array_agg(actor_nombre order by created_at desc))[1] as actor
        from configuracion_historial
       where cliente = ${cliente}::cliente_t
         and (${args.clinicaId}::text is null or clinica_id = ${args.clinicaId})
       group by 1, 2, 3
       order by 1 desc
       limit ${args.limite ?? 20}`.execute(trx),
  );
  return (r.rows ?? []).map((h) => ({
    dia: h.dia,
    campo: h.campo,
    etiqueta: etiquetaHito(h.tabla, h.campo, h.antes, h.despues),
    antes: h.antes,
    despues: h.despues,
    actor: h.actor,
  }));
}
