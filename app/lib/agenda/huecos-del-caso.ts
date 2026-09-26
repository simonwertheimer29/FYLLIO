// app/lib/agenda/huecos-del-caso.ts
//
// LOS HUECOS PARA UN CASO (17-09, paso 3 de la ficha — MEJORAS 253).
//
// La coordinadora tiene la conversación abierta y el agente ya recogió cuándo
// le viene bien a la persona (`preferenciaCita`: días EN SU ORDEN, franja,
// urgencia). Esto convierte eso en tres huecos concretos, en el SERVIDOR, con
// lo que Fyllio garantiza sobre ellos (garantia.ts). La pantalla se compone de
// esta respuesta.
//
// CÓMO BUSCA (decisiones de Simon, 16-09): prueba los días preferidos EN ESE
// ORDEN dentro de la ventana; dentro de cada día, la franja pedida. Si no hay
// nada, AMPLÍA SOLA y lo dice: primero suelta la franja (cualquier hora de
// esos días), luego los días (cualquier día con esa franja), luego todo. La
// respuesta lleva `ampliado` para que el panel diga «no hay mañanas los
// jueves; estos son los más cercanos» en vez de enseñar un martes sin
// explicar por qué.
//
// LO QUE NO HACE, a propósito: no adivina la duración. Sin tratamiento del
// catálogo no hay slots (motor, §4): se intenta casar el tratamiento que dijo
// la persona con el catálogo por nombre; si no casa, la respuesta lo dice y
// el panel pide elegirlo. Y un doctor cuya agenda externa está rota no
// aporta huecos: jamás huecos frescos sobre lectura rancia.
//
// EL MOTOR es el mismo que la agenda (disponibilidad.ts: franjasDelDia,
// proyectarAlDia, disponibilidadDia, trocearEnSlots). Lo que se repite de
// /api/agenda/semana es la CARGA de ocupación (bloqueos, citas, externas), no
// la aritmética — deuda anotada: la ruta de la semana calcula lo mismo con la
// forma que necesita su rejilla.

import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO, horaClinica, sumaDias, inicioDelDiaUTC } from "../time";
import {
  aMin,
  deMin,
  diaSemanaISO,
  disponibilidadDia,
  franjasDelDia,
  proyectarAlDia,
  trocearEnSlots,
  type IntervaloMin,
} from "./disponibilidad";
import { garantiaDe, leerAgendaEnFyllio, type GarantiaAgenda } from "./garantia";
import type { DiaSemana, PreferenciaCita } from "../agente/evaluador";
import { pegadaA } from "./separacion";

/** Ventana de búsqueda: dos semanas. Más allá, ofrecer un hueco a quien dijo
 *  «cuanto antes» no es ayudarle. */
const VENTANA_DIAS = 14;
const MAX_HUECOS = 3;
/** Hoy solo cuentan los huecos que empiezan al menos una hora después de ahora. */
const MARGEN_HOY_MIN = 60;
/** «Mañana» termina a las 15:00 (Simon, 23-09: para mucha gente las 14:00
 *  todavía no es «por la tarde»). Lo usan la franja pedida y el cambio de
 *  franja de las alternativas; nada más en el producto define la tarde. */
const FIN_MANANA_MIN = 15 * 60;

const DIA_ISO: Record<DiaSemana, number> = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7 };

export type HuecoDelCaso = {
  fecha: string;
  hora: string;
  fin: string;
  doctorId: string;
  doctorNombre: string;
  clinicaId: string | null;
  clinicaNombre: string | null;
  /** Solo en el selector: si cumple lo que pidió o es una alternativa. */
  bloque?: Bloque;
};

export type Ampliacion = null | "franja" | "dias" | "todo";

export type RespuestaHuecos = {
  huecos: HuecoDelCaso[];
  garantia: GarantiaAgenda;
  /** Cuánto se salió de la preferencia para encontrarlos. */
  ampliado: Ampliacion;
  /** La frase de por qué no hay (o por qué se amplió), para el panel. */
  nota: string | null;
  tratamiento: { id: string; nombre: string; duracionMin: number } | null;
  /** Para elegir cuando no casó ninguno: el catálogo con duración. */
  catalogo: { id: string; nombre: string; duracionMin: number }[];
  preferencia: PreferenciaCita | null;
  /** Por qué doctor se filtra: el elegido a mano, o el que pidió la persona
   *  (`doctorPedido.casado`). null = todos los de la clínica. */
  doctorFiltrado: { id: string; nombre: string } | null;
  /** El doctor elegido no es de la clínica del caso: se ignoró. */
  doctorFueraDeClinica: string | null;
  /** 062 — el doctor elegido a mano o el que pidió la persona no hace este
   *  tratamiento: se ignoró y se ofrecen los que sí lo hacen. */
  doctorNoLoHace: string | null;
  /** Lo que dijo la persona del doctor, y si casó con uno de la clínica. */
  doctorPedido: { texto: string; casado: boolean } | null;
  /** Los doctores de la clínica con horario, para filtrar a mano. */
  doctores: { id: string; nombre: string }[];
  /** La hora concreta que pidió («a las 8:30»), "HH:MM"; null si no pidió. */
  horaPedida: string | null;
  /** Selector: pidió prisa y lo que encaja está lejos → las de antes arriba. */
  alternativasPrimero: boolean;
  /** Solo en «cercania»: la propuesta que el selector trae ya marcada. */
  sugeridas?: HuecoDelCaso[];
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Casa el tratamiento que DIJO la persona con el catálogo por nombre: «una
 *  limpieza» ↔ «Limpieza dental». Inclusión en cualquier sentido de la
 *  palabra más larga; si casan varios, ninguno (se pide elegir). */
export function casarTratamiento<T extends { id: string; nombre: string; duracionMin: number }>(
  texto: string | null,
  catalogo: readonly T[],
): T | null {
  return casarPorNombre(texto, catalogo);
}

/** Casa lo que dijo la persona con UNO de la lista por nombre; si casan
 *  varios o ninguno, null (se pide elegir — nunca `candidatos[0]`, §20). */
function casarPorNombre<T extends { nombre: string }>(texto: string | null, lista: readonly T[]): T | null {
  if (!texto) return null;
  const palabras = norm(texto).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (palabras.length === 0) return null;
  const candidatos = lista.filter((t) => {
    const n = norm(t.nombre);
    return palabras.some((w) => n.includes(w)) || n.split(/[^a-z0-9]+/).some((w) => w.length >= 4 && palabras.includes(w));
  });
  return candidatos.length === 1 ? candidatos[0]! : null;
}

/** El doctor que PIDIÓ la persona («con la doctora Ferrer»), entre los de la
 *  clínica del caso. Es la ÚNICA razón para filtrar por doctor sin que lo
 *  pida la coordinadora (22-09, Simon): el doctor asignado al lead no es una
 *  preferencia de la paciente. */
export const casarDoctor = <T extends { nombre: string }>(texto: string | null, doctores: readonly T[]) => casarPorNombre(texto, doctores);

/** La hora concreta que dijo la persona («cualquier día a las 8:30», «sobre
 *  las 17h»), en minutos del día; null si no dijo ninguna. Sale del texto
 *  recogido de disponibilidad, no del modelo: la preferencia estructurada solo
 *  trae franja y días. «A las 5» sin «mañana» es de la tarde (en una clínica
 *  nadie pide las 5 de la madrugada). */
export function horaPedidaDe(texto: string | null): number | null {
  if (!texto) return null;
  const t = norm(texto);
  const m =
    t.match(/\b(?:a|sobre|hacia|de|desde|antes de|despues de) las\s+(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?/) ??
    t.match(/\b(\d{1,2})[:.](\d{2})\b/) ??
    t.match(/\b(\d{1,2})\s*h\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (!Number.isInteger(h) || h > 23 || min > 59) return null;
  if (h >= 1 && h <= 7 && !/manana/.test(t)) h += 12;
  return h * 60 + min;
}

/** «Cerca de la hora pedida»: la misma franja del día a una hora de
 *  distancia — quien dice «a las 8:30» acepta las 9:00, no las 13:00. */
const CERCA_HORA_MIN = 60;

function enFranja(inicioMin: number, franja: PreferenciaCita["franja"]): boolean {
  if (!franja || franja === "indiferente") return true;
  return franja === "manana" ? inicioMin < FIN_MANANA_MIN : inicioMin >= FIN_MANANA_MIN;
}

type SlotDia = { fecha: string; slot: IntervaloMin; doctorId: string };

// ─── El selector «Proponer horas» en dos bloques (22-09, tercera vuelta) ────
//
// Simon: «Cumplen lo que pidió» primero —los días que encajan, del más cercano
// a hoy— y, separado, «Alternativas cercanas». Cada bloque trae TODOS los
// huecos de sus días y de todos los doctores, sin espaciar: la coordinadora ve
// el día y marca (la separación de 60 min se aplica al MENSAJE, no aquí).
// Más días es scroll, no opciones: quien quiera otro día navega la agenda.

/** Ventana del selector: cuatro semanas. Con dos, a quien pide «martes por la
 *  tarde» le cabía UN martes, y la regla de 60 min le deja una hora por día. */
const VENTANA_SELECTOR = 28;
const DIAS_CUMPLEN = 3;
const DIAS_ALTERNATIVAS = 3;
/** De la OTRA franja, solo las horas más pegadas a la pedida: a quien pidió
 *  tarde se le ofrecen las últimas de la mañana, no las 9:00. */
const HORAS_OTRA_FRANJA = 3;
/** «A las 9:30» casa con una hora de la rejilla a ≤ 15 min (la de 9:20 o la de
 *  9:40 si la rejilla es de 20). Más lejos ya es «alrededor». */
const EXACTA_MIN = 15;
/** Quien dijo «cuanto antes» y lo que encaja está a más de una semana: las
 *  horas de antes pesan más que el día que pidió (Simon, 22-09). */
const LEJOS_URGENTE_DIAS = 7;

export type Bloque = "cumple" | "alternativa";
type Grupo = { fecha: string; slots: SlotDia[] };

/** PURA: los dos bloques del selector. `alternativasPrimero` = pidió prisa y lo
 *  que encaja está lejos: las de antes van arriba y se dice en `motivoUrgencia`. */
export function huecosPorBloques(
  slots: readonly SlotDia[],
  pref: PreferenciaCita | null,
  horaPedida: number | null,
  hoy: string,
): { cumplen: SlotDia[]; alternativas: SlotDia[]; alternativasPrimero: boolean; primeraQueCumple: string | null } {
  const dias = pref?.dias ?? [];
  const franja = pref?.franja && pref.franja !== "indiferente" ? pref.franja : null;
  const diaOk = (x: SlotDia) => dias.length === 0 || dias.some((d) => DIA_ISO[d] === diaSemanaISO(x.fecha));
  const orden = (a: SlotDia, b: SlotDia) => a.fecha.localeCompare(b.fecha) || a.slot.inicio - b.slot.inicio || a.doctorId.localeCompare(b.doctorId);
  const todos = [...slots].sort(orden);
  const fechasDe = (l: readonly SlotDia[]) => [...new Set(l.map((x) => x.fecha))];
  const grupos = (l: readonly SlotDia[]): Grupo[] => fechasDe(l).map((fecha) => ({ fecha, slots: l.filter((x) => x.fecha === fecha) }));
  /** De la otra franja de un día, las N horas más pegadas al cambio de franja. */
  const otraFranjaCerca = (delDia: readonly SlotDia[]): SlotDia[] => {
    if (!franja) return [];
    const fuera = delDia.filter((x) => !enFranja(x.slot.inicio, franja));
    const dist = (m: number) => Math.abs(m - FIN_MANANA_MIN);
    const horas = [...new Set(fuera.map((x) => x.slot.inicio))].sort((a, b) => dist(a) - dist(b)).slice(0, HORAS_OTRA_FRANJA);
    return fuera.filter((x) => horas.includes(x.slot.inicio));
  };
  const plano = (gs: readonly Grupo[]) => gs.flatMap((g) => g.slots).sort(orden);

  let cumplen: SlotDia[];
  let alternativas: Grupo[] = [];
  if (horaPedida != null) {
    // Esa hora (la de la rejilla más cercana, a ≤ 15 min) en los días más
    // cercanos, con cada doctor que la tenga; abajo, las de alrededor.
    const candidatos = todos.filter(diaOk);
    const mejor = new Map<string, number>();
    for (const x of candidatos) {
      const d = Math.abs(x.slot.inicio - horaPedida);
      if (d <= EXACTA_MIN) mejor.set(x.fecha, Math.min(mejor.get(x.fecha) ?? Infinity, d));
    }
    const exactas = candidatos.filter((x) => mejor.get(x.fecha) === Math.abs(x.slot.inicio - horaPedida));
    const fc = fechasDe(exactas).slice(0, DIAS_CUMPLEN);
    cumplen = exactas.filter((x) => fc.includes(x.fecha));
    if (cumplen.length > 0) {
      alternativas = grupos(todos.filter((x) => fc.includes(x.fecha) && Math.abs(x.slot.inicio - horaPedida) <= CERCA_HORA_MIN && !cumplen.includes(x)));
    } else {
      // Nada a esa hora: las más cercanas de cada día (de los que pidió, o de
      // cualquiera), no el día entero — quien pidió las 8:30 quiere las 10:00.
      const base = candidatos.length > 0 ? candidatos : todos;
      const fa = fechasDe(base).slice(0, DIAS_ALTERNATIVAS);
      alternativas = grupos(base.filter((x) => fa.includes(x.fecha))).map((g) => {
        const min = Math.min(...g.slots.map((x) => Math.abs(x.slot.inicio - horaPedida)));
        return { fecha: g.fecha, slots: g.slots.filter((x) => Math.abs(x.slot.inicio - horaPedida) <= min + CERCA_HORA_MIN) };
      });
    }
  } else {
    const encaja = (x: SlotDia) => diaOk(x) && enFranja(x.slot.inicio, franja);
    const siCumple = todos.filter(encaja);
    const fc = fechasDe(siCumple).slice(0, DIAS_CUMPLEN);
    cumplen = siCumple.filter((x) => fc.includes(x.fecha));
    if (dias.length > 0 || franja) {
      // (A) lo pedido de hora en OTROS días, del más cercano a hoy;
      const otrosDias = grupos(todos.filter((x) => !diaOk(x) && enFranja(x.slot.inicio, franja)));
      // (B) la otra franja de los días que cumplen, solo lo más pegado;
      const otraEnCumplen = fc.map((fecha) => ({ fecha, slots: otraFranjaCerca(todos.filter((x) => x.fecha === fecha)) }));
      // (C) si nada cumple: la otra franja de los días que pidió.
      const otraEnPedidos = grupos(todos.filter((x) => diaOk(x) && !fc.includes(x.fecha))).map((g) => ({ fecha: g.fecha, slots: otraFranjaCerca(g.slots) }));
      const cand = [...otrosDias.slice(0, cumplen.length > 0 ? 2 : DIAS_ALTERNATIVAS), ...otraEnCumplen, ...otraEnPedidos].filter((g) => g.slots.length > 0);
      alternativas = cand.slice(0, DIAS_ALTERNATIVAS);
    }
  }

  // Prisa y lo que encaja queda lejos: las alternativas son LAS DE ANTES, y van arriba.
  const primeraQueCumple = cumplen[0]?.fecha ?? null;
  let alternativasPrimero = false;
  const urgencia = pref?.urgencia ?? null;
  if (urgencia === "cuanto_antes" || urgencia === "esta_semana") {
    const limite = urgencia === "esta_semana" ? sumaDias(hoy, 7 - diaSemanaISO(hoy)) : sumaDias(hoy, LEJOS_URGENTE_DIAS);
    if (primeraQueCumple == null || primeraQueCumple > limite) {
      const antes = todos.filter((x) => primeraQueCumple == null || x.fecha < primeraQueCumple);
      const deAntes = grupos(antes)
        .slice(0, DIAS_ALTERNATIVAS)
        .map((g) => {
          const enLaFranja = g.slots.filter((x) => enFranja(x.slot.inicio, franja));
          return { fecha: g.fecha, slots: enLaFranja.length > 0 ? enLaFranja : otraFranjaCerca(g.slots) };
        })
        .filter((g) => g.slots.length > 0);
      if (deAntes.length > 0 && cumplen.length > 0) {
        alternativas = deAntes;
        alternativasPrimero = true;
      }
    }
  }
  return { cumplen, alternativas: plano(alternativas), alternativasPrimero, primeraQueCumple };
}

/** La frase de arriba del selector: por qué no hay lo pedido, o por qué las
 *  de antes van primero. null cuando lo que se ve se explica solo. */
function notaBloques(
  r: { cumplen: readonly SlotDia[]; alternativas: readonly SlotDia[]; alternativasPrimero: boolean; primeraQueCumple: string | null },
  pref: PreferenciaCita | null,
  horaPedida: number | null,
): string | null {
  if (r.alternativasPrimero && r.primeraQueCumple) {
    const prisa = pref?.urgencia === "esta_semana" ? "esta semana" : "cuanto antes";
    return `Pidió ${prisa} y lo primero que encaja es el ${fechaLarga(r.primeraQueCumple)}: arriba, las horas de antes.`;
  }
  if (r.cumplen.length > 0) return null;
  if (r.alternativas.length === 0) return `Sin huecos en las próximas cuatro semanas. Mira toda la agenda.`;
  const franjaTxt = horaPedida != null ? `a las ${deMin(horaPedida).replace(/^0/, "")}` : pref?.franja === "manana" ? "por la mañana" : pref?.franja === "tarde" ? "por la tarde" : null;
  const diasTxt = pref?.dias?.length ? `los ${pref.dias.map((d) => NOMBRE_DIA[d]).join(" o ")}` : null;
  const lo = [diasTxt, franjaTxt].filter(Boolean).join(" ");
  return `No hay nada ${lo} en cuatro semanas: estas son las horas más cercanas.`.replace(/\s+/g, " ");
}

const NOMBRE_DIA: Record<DiaSemana, string> = { lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábados", dom: "domingos" };
const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

/** PURA (23-09, Simon): la PROPUESTA que el selector trae ya marcada. Es la
 *  única regla de sugerencia: la usan el selector, el repuesto automático
 *  cuando se ocupa una hora (ofertas.ts) y la usará el agente. Sin modelo.
 *  Elige de una en una, y entre las candidatas gana, por este orden:
 *   1. un día que aún no está en la propuesta;
 *   2. el doctor que menos sale ya;
 *   3. una hora del día distinta (a ≥ 60 min de las ya elegidas, aunque sean
 *      de otro día: tres martes a las 14:00 fallan juntos) — salvo que pidiera
 *      una hora concreta, que entonces es justo la que se repite;
 *   4. la más cercana: la fecha más próxima y, dentro, la primera hora (o la
 *      más cercana a la pedida).
 *  Nunca dos del mismo día a menos de 60 min. Primero «cumplen» y, si no
 *  llegan, «alternativas»; con prisa y lo que encaja lejos, dos de las de
 *  ANTES y una que cumple. `ya` = horas que ya están (las vivas del repuesto):
 *  cuentan para todo y ocupan sitio. */
export function sugerirPropuesta<T extends { fecha: string; hora: string; doctorId: string; bloque?: Bloque }>(
  huecos: readonly T[],
  opts: { alternativasPrimero: boolean; horaPedida: number | null; max?: number; ya?: readonly { fecha: string; hora: string; doctorId: string }[] },
): T[] {
  const max = opts.max ?? MAX_HUECOS;
  const ya = opts.ya ?? [];
  const out: T[] = [];
  const mismo = (a: { fecha: string; hora: string; doctorId: string }, b: { fecha: string; hora: string; doctorId: string }) =>
    a.fecha === b.fecha && a.hora === b.hora && a.doctorId === b.doctorId;
  const elegir = (pool: readonly T[], hasta: number) => {
    while (out.length + ya.length < hasta) {
      const hechas = [...ya, ...out];
      const cand = pool.filter((c) => !hechas.some((h) => mismo(h, c)) && !pegadaA(c, hechas));
      if (cand.length === 0) return;
      const clave = (c: T): number[] => {
        const m = aMin(c.hora);
        return [
          hechas.some((h) => h.fecha === c.fecha) ? 1 : 0,
          hechas.filter((h) => h.doctorId === c.doctorId).length,
          opts.horaPedida == null && hechas.some((h) => Math.abs(aMin(h.hora) - m) < SEPARACION_HORA_MIN) ? 1 : 0,
          Number(c.fecha.replaceAll("-", "")),
          opts.horaPedida == null ? m : Math.abs(m - opts.horaPedida),
        ];
      };
      const menor = (a: number[], b: number[]) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
        return false;
      };
      let mejor = cand[0]!;
      let km = clave(mejor);
      for (const c of cand.slice(1)) {
        const k = clave(c);
        if (menor(k, km) || (!menor(km, k) && c.doctorId < mejor.doctorId)) { mejor = c; km = k; }
      }
      out.push(mejor);
    }
  };
  const cumplen = huecos.filter((h) => h.bloque !== "alternativa");
  const alternativas = huecos.filter((h) => h.bloque === "alternativa");
  if (opts.alternativasPrimero) {
    elegir(alternativas, Math.max(1, max - 1));
    elegir(cumplen, max);
  } else {
    elegir(cumplen, max);
  }
  elegir(alternativas, max);
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
}
/** «Hora distinta» en la sugerencia: la misma separación que el mensaje. */
const SEPARACION_HORA_MIN = 60;

type ParametrosCaso = {
  preferencia: PreferenciaCita | null;
  /** Lo que dijo la persona que quiere («una limpieza»), para casar con el catálogo. */
  tratamientoTexto: string | null;
  /** Elegido a mano en el panel; manda sobre el casado. */
  tratamientoId: string | null;
  /** Doctor elegido A MANO por la coordinadora; null = todos los que tienen
   *  horario. El doctor asignado al lead NO se pasa aquí (22-09): no es una
   *  preferencia de la paciente. */
  doctorId: string | null;
  /** Lo que dijo la persona del doctor («con la doctora Ferrer»). Si casa con
   *  UNO de la clínica y no hay `doctorId`, filtra por él y se dice. */
  doctorPedidoTexto?: string | null;
  /** Lo que dijo de cuándo («cualquier día a las 8:30»): de ahí la hora. */
  disponibilidadTexto?: string | null;
  /** LA CLÍNICA DEL CASO (17-09, bug grave visto por Simon): solo se ofrecen
   *  doctores de ESTA clínica. El lead de Centro tenía asignado un doctor de
   *  Norte y la confirmación decía «tu cita en Clínica Demo Norte». null =
   *  sin clínica conocida: todas (se dice en la nota). */
  clinicaId: string | null;
  hoy?: string;
  ahora?: Date;
  /** 17-09 (bucle de ofertas) — «todos»: TODOS los huecos de la ventana en
   *  orden de fecha, sin escalera ni ampliación (la coordinadora navega la
   *  agenda entera; el motor comprueba si una alternativa sigue libre).
   *  Default «preferencia»: los tres que mejor cumplen lo que pidió.
   *  «cercania» (22-09, selector «Proponer horas»): dos bloques, «cumplen» y
   *  «alternativas» (`huecosPorBloques`), con todos sus huecos, en 4 semanas. */
  modo?: "preferencia" | "todos" | "cercania";
  /** Primer día de la ventana (YYYY-MM-DD, nunca antes de hoy) y cuántos
   *  días abarca. Defaults: hoy y dos semanas. */
  desde?: string;
  dias?: number;
  /** Tope de huecos devueltos (default 3 en «preferencia», 300 en «todos»). */
  max?: number;
};

/** 062 (MEJORAS 265) — qué doctores hacen un tratamiento. Sin especialidad
 *  en el tratamiento, todos, como antes de la 062. Con ella, los de esa
 *  especialidad; si no queda ninguno, se devuelve vacío y el que llama lo
 *  dice: no se rellena con los demás. */
export function quienesLoHacen<T extends { id: string }>(
  especialidadId: string | null,
  doctores: readonly T[],
  asignaciones: readonly { staff_id: string; especialidad_id: string }[],
): T[] {
  if (!especialidadId) return [...doctores];
  const ids = new Set(asignaciones.filter((a) => a.especialidad_id === especialidadId).map((a) => a.staff_id));
  return doctores.filter((s) => ids.has(s.id));
}

/** Los intervalos LIBRES de cada doctor implicado, por día, con la huella
 *  (duración + buffers) del tratamiento: la verdad de la que salen los slots.
 *  Lo comparte `huecosDelCaso` (que trocea) con `libresDelCaso` (que
 *  comprueba si UNA hora concreta cabe — sin depender de la rejilla, que se
 *  desplaza en cuanto algo ocupa un trozo). */
async function disponibilidadDelCaso(p: ParametrosCaso) {
  const cliente = requireCliente("huecosDelCaso");
  const ahora = p.ahora ?? new Date();
  const hoy = p.hoy ?? hoyISO(ahora);
  const modo = p.modo ?? "preferencia";
  const ventana = Math.max(1, Math.min(p.dias ?? (modo === "todos" ? VENTANA_DIAS : VENTANA_SELECTOR), 60));
  const primerDia = p.desde && p.desde > hoy ? p.desde : hoy;
  const fechas = Array.from({ length: ventana }, (_, i) => (i === 0 ? primerDia : sumaDias(primerDia, i)));
  const desdeUTC = inicioDelDiaUTC(primerDia);
  const hastaUTC = inicioDelDiaUTC(sumaDias(primerDia, ventana));

  const d = await runWithClienteDb(cliente, async (trx) => {
    const agendaEnFyllio = await leerAgendaEnFyllio(trx);
    const staff = await trx
      .selectFrom("staff")
      .leftJoin("clinicas", (j) => j.onRef("clinicas.id", "=", "staff.clinica_id"))
      .select(["staff.id", "staff.nombre", "staff.rol", "staff.activo", "staff.clinica_id", "clinicas.nombre as clinica_nombre"])
      .execute();
    const horarios = await trx.selectFrom("horarios_staff").select(["staff_id", "dia_semana", "inicio", "fin"]).execute();
    const catalogo = await trx.selectFrom("tratamientos").select(["id", "nombre", "duracion_min", "buffer_antes_min", "buffer_despues_min", "especialidad_id"]).orderBy("nombre").execute();
    const especialidades = await trx.selectFrom("especialidades").select(["id", "nombre"]).execute();
    const asignaciones = await trx.selectFrom("staff_especialidades").select(["staff_id", "especialidad_id"]).execute();
    const bloqueos = await trx.selectFrom("bloqueos_staff").select(["staff_id", "inicio", "fin"]).where("fin", ">", desdeUTC).where("inicio", "<", hastaUTC).execute();
    const citas = await trx
      .selectFrom("citas")
      .select(["profesional_id", "hora_inicio", "hora_final"])
      .where("hora_inicio", ">=", desdeUTC)
      .where("hora_inicio", "<", hastaUTC)
      .where("estado", "in", ["Programada", "Confirmada", "Completado"])
      .execute();
    const agendasExternas = await trx
      .selectFrom("agendas_externas")
      .select(["id", "staff_id", "fuente", "ultimo_sync_ok", "ultimo_error"])
      .where("activa", "=", true)
      .execute();
    const ocupaciones = agendasExternas.length
      ? await trx
          .selectFrom("ocupaciones_externas")
          .select(["agenda_externa_id", "inicio", "fin"])
          .where("agenda_externa_id", "in", agendasExternas.map((a) => a.id))
          .where("fin", ">", desdeUTC)
          .where("inicio", "<", hastaUTC)
          .execute()
      : [];
    return { agendaEnFyllio, staff, horarios, catalogo, especialidades, asignaciones, bloqueos, citas, agendasExternas, ocupaciones };
  });

  const catalogo = d.catalogo
    .filter((t: any) => Number.isInteger(t.duracion_min) && t.duracion_min > 0)
    .map((t: any) => ({ id: t.id as string, nombre: (t.nombre ?? "") as string, duracionMin: t.duracion_min as number, antes: t.buffer_antes_min ?? 0, despues: t.buffer_despues_min ?? 0, especialidadId: (t.especialidad_id ?? null) as string | null }));
  const tratamiento = p.tratamientoId ? catalogo.find((t) => t.id === p.tratamientoId) ?? null : casarTratamiento(p.tratamientoTexto, catalogo);

  const dentistasDeLaClinica = d.staff.filter(
    (s: any) => (s.rol ?? "") === "Dentista" && s.activo !== false && (!p.clinicaId || s.clinica_id === p.clinicaId),
  );
  // 062 (MEJORAS 265) — solo quien HACE el tratamiento. Sin tratamiento
  // elegido todavía, todos (sin él tampoco se calculan huecos).
  const loHacen: any[] = quienesLoHacen(tratamiento?.especialidadId ?? null, dentistasDeLaClinica as any[], d.asignaciones);
  // Un doctor asignado de OTRA clínica no filtra: se ofrecen los de la clínica
  // del caso y se avisa (`doctorFueraDeClinica`).
  const asignadoEnClinica = p.doctorId ? dentistasDeLaClinica.find((s: any) => s.id === p.doctorId) ?? null : null;
  const doctorFueraDeClinica = p.doctorId != null && asignadoEnClinica == null
    ? (d.staff.find((s: any) => s.id === p.doctorId)?.nombre ?? p.doctorId)
    : null;
  const horariosDe = new Map<string, Array<{ dia_semana: number; inicio: string; fin: string }>>();
  for (const h of d.horarios) horariosDe.set(h.staff_id, [...(horariosDe.get(h.staff_id) ?? []), h]);
  // Sin elección a mano, el doctor que PIDIÓ la persona, si casa con uno solo.
  const pedidoTexto = p.doctorId == null ? (p.doctorPedidoTexto ?? "").trim() || null : null;
  const pedido = pedidoTexto ? casarDoctor(pedidoTexto, dentistasDeLaClinica as Array<{ nombre: string }>) : null;
  // El elegido a mano o el que pidió, si no hace este tratamiento, tampoco
  // filtra: se ofrecen los que sí y se dice (`doctorNoLoHace`).
  const candidato: any = asignadoEnClinica ?? pedido;
  const candidatoLoHace = candidato != null && loHacen.some((s: any) => s.id === candidato.id);
  const doctorFiltrado: any = candidatoLoHace ? candidato : null;
  const doctorNoLoHace: string | null = candidato != null && !candidatoLoHace ? (candidato.nombre ?? "") : null;
  const doctores = doctorFiltrado ? [doctorFiltrado] : loHacen;
  /** Los que lo hacen con horario: los que se pueden elegir a mano. */
  const elegibles = loHacen
    .filter((s: any) => (horariosDe.get(s.id) ?? []).length > 0)
    .map((s: any) => ({ id: s.id as string, nombre: (s.nombre ?? "") as string }));
  const doctorPedido = pedidoTexto ? { texto: pedidoTexto, casado: pedido != null } : null;

  // Doctores implicados = con horario. Los de agenda externa rota se apartan.
  const externasDe = new Map<string, typeof d.agendasExternas>();
  for (const a of d.agendasExternas) externasDe.set(a.staff_id, [...(externasDe.get(a.staff_id) ?? []), a]);
  const implicados = doctores.filter((s: any) => (horariosDe.get(s.id) ?? []).length > 0);
  const rotos = new Set(implicados.filter((s: any) => (externasDe.get(s.id) ?? []).some((a) => !a.ultimo_sync_ok || a.ultimo_error)).map((s: any) => s.id));
  const garantia = garantiaDe({
    agendaEnFyllio: d.agendaEnFyllio,
    externas: implicados.flatMap((s: any) => (externasDe.get(s.id) ?? []).map((a) => ({ staffId: s.nombre ?? s.id, fuente: a.fuente, ultimoSyncOk: a.ultimo_sync_ok, ultimoError: a.ultimo_error }))),
  });

  const sinTratamiento = !tratamiento
    ? catalogo.length ? "Elige el tipo de cita: su duración define los huecos." : "Ningún tratamiento tiene duración configurada — sin ella no se calculan huecos (Ajustes → Agenda)."
    : null;
  const especialidad = tratamiento?.especialidadId ? d.especialidades.find((e: any) => e.id === tratamiento.especialidadId)?.nombre ?? null : null;
  const sinDoctores = implicados.length === 0
    ? doctorFiltrado ? `${doctorFiltrado.nombre} no tiene horario configurado — sin él no se calculan huecos.`
      : tratamiento?.especialidadId && loHacen.length === 0
        ? `${p.clinicaId ? "En esta clínica nadie" : "Nadie"} hace ${tratamiento.nombre}${especialidad ? ` (${especialidad})` : ""}: quién lo hace se configura en Ajustes → Agenda.`
        : tratamiento?.especialidadId ? `Quien hace ${tratamiento.nombre} no tiene horario configurado (Ajustes → Agenda).`
          : "Ningún doctor tiene horario configurado (Ajustes → Agenda)."
    : null;

  /** fecha → doctorId → intervalos libres del día (ya restadas citas,
   *  bloqueos y ocupaciones externas). Un día con una cita sin medir no
   *  aparece: no se afirman huecos sobre él (§4). */
  const libres = new Map<string, Map<string, IntervaloMin[]>>();
  const minHoy = aMin(horaClinica(ahora)) + MARGEN_HOY_MIN;
  for (const doc of tratamiento && !sinDoctores ? implicados : []) {
    if (rotos.has(doc.id)) continue;
    const agendaIds = new Set((externasDe.get(doc.id) ?? []).map((a) => a.id));
    for (const fecha of fechas) {
      const franjas = franjasDelDia(horariosDe.get(doc.id) ?? [], fecha);
      if (franjas.length === 0) continue;
      const ocup: IntervaloMin[] = [];
      let sinDuracion = false;
      for (const b of d.bloqueos) {
        if (b.staff_id !== doc.id) continue;
        const pr = proyectarAlDia({ inicio: new Date(b.inicio as any), fin: new Date(b.fin as any) }, fecha);
        if (pr) ocup.push(pr);
      }
      for (const c of d.citas) {
        if (c.profesional_id !== doc.id || !c.hora_inicio) continue;
        const ini = new Date(c.hora_inicio as any);
        if (hoyISO(ini) !== fecha) continue;
        if (!c.hora_final) { sinDuracion = true; break; }
        const pr = proyectarAlDia({ inicio: ini, fin: new Date(c.hora_final as any) }, fecha);
        if (pr) ocup.push(pr);
      }
      if (sinDuracion) continue; // una cita sin medir ese día: no se afirman huecos (§4)
      for (const o of d.ocupaciones) {
        if (!agendaIds.has(o.agenda_externa_id)) continue;
        const pr = proyectarAlDia({ inicio: new Date(o.inicio as any), fin: new Date(o.fin as any) }, fecha);
        if (pr) ocup.push(pr);
      }
      const dia = disponibilidadDia({ franjas, ocupaciones: ocup });
      if (!libres.has(fecha)) libres.set(fecha, new Map());
      libres.get(fecha)!.set(doc.id, dia);
    }
  }

  return { ahora, hoy, modo, fechas, minHoy, tratamiento, catalogo, implicados, doctorFiltrado, doctorFueraDeClinica, doctorNoLoHace, doctorPedido, elegibles, garantia, libres, sinTratamiento, sinDoctores };
}

/** ¿Cabe una cita de este tratamiento a ESTA hora con ESTE doctor? Mira los
 *  intervalos libres (con buffers), no la rejilla de slots. */
export async function libresDelCaso(p: ParametrosCaso): Promise<{
  cabe: (a: { fecha: string; hora: string; doctorId: string }) => boolean;
  tratamiento: { id: string; nombre: string; duracionMin: number } | null;
  nota: string | null;
}> {
  const d = await disponibilidadDelCaso(p);
  const t = d.tratamiento;
  return {
    tratamiento: t ? { id: t.id, nombre: t.nombre, duracionMin: t.duracionMin } : null,
    nota: d.sinTratamiento ?? d.sinDoctores,
    cabe: (a) => {
      if (!t) return false;
      const ini = aMin(a.hora);
      if (a.fecha === d.hoy && ini < d.minHoy) return false;
      const desde = ini - t.antes;
      const hasta = ini + t.duracionMin + t.despues;
      return (d.libres.get(a.fecha)?.get(a.doctorId) ?? []).some((l) => l.inicio <= desde && hasta <= l.fin);
    },
  };
}

export async function huecosDelCaso(p: ParametrosCaso): Promise<RespuestaHuecos> {
  const d = await disponibilidadDelCaso(p);
  const { hoy, modo, tratamiento, catalogo, implicados, doctorFiltrado, doctorFueraDeClinica, doctorNoLoHace, doctorPedido, elegibles, garantia, minHoy } = d;
  const horaPedida = horaPedidaDe(p.disponibilidadTexto ?? null);

  const salida = (huecos: HuecoDelCaso[], ampliado: Ampliacion, nota: string | null): RespuestaHuecos => ({
    huecos,
    garantia,
    ampliado,
    nota,
    tratamiento: tratamiento ? { id: tratamiento.id, nombre: tratamiento.nombre, duracionMin: tratamiento.duracionMin } : null,
    catalogo: catalogo.map(({ id, nombre, duracionMin }) => ({ id, nombre, duracionMin })),
    preferencia: p.preferencia,
    doctorFiltrado: doctorFiltrado ? { id: doctorFiltrado.id, nombre: doctorFiltrado.nombre ?? "" } : null,
    doctorFueraDeClinica,
    doctorNoLoHace,
    doctorPedido,
    doctores: elegibles,
    horaPedida: horaPedida == null ? null : deMin(horaPedida),
    alternativasPrimero: false,
  });
  if (d.sinTratamiento) return salida([], null, d.sinTratamiento);
  if (d.sinDoctores) return salida([], null, d.sinDoctores);

  const slots: SlotDia[] = [];
  for (const [fecha, porDoctor] of d.libres) {
    for (const [doctorId, libres] of porDoctor) {
      for (const s of trocearEnSlots(libres, { duracionMin: tratamiento!.duracionMin, bufferAntesMin: tratamiento!.antes, bufferDespuesMin: tratamiento!.despues })) {
        if (fecha === hoy && s.inicio < minHoy) continue;
        slots.push({ fecha, slot: s, doctorId });
      }
    }
  }

  const nombreDe = new Map(implicados.map((s: any) => [s.id, s]));
  const aHueco = (e: SlotDia, bloque?: Bloque): HuecoDelCaso => {
    const s: any = nombreDe.get(e.doctorId);
    return { fecha: e.fecha, hora: deMin(e.slot.inicio), fin: deMin(e.slot.fin), doctorId: e.doctorId, doctorNombre: s?.nombre ?? "", clinicaId: s?.clinica_id ?? null, clinicaNombre: s?.clinica_nombre ?? null, ...(bloque ? { bloque } : {}) };
  };
  if (modo === "todos") {
    const todos = [...slots]
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.slot.inicio - b.slot.inicio || a.doctorId.localeCompare(b.doctorId))
      .slice(0, p.max ?? 300);
    return salida(todos.map((e) => aHueco(e)), null, null);
  }
  // «cercania» (el selector) y «preferencia» (las tres de siempre) salen de
  // los MISMOS bloques y la MISMA sugerencia: una sola regla (23-09).
  const b = huecosPorBloques(slots, p.preferencia, horaPedida, hoy);
  const bloques = [...b.cumplen.map((e) => aHueco(e, "cumple")), ...b.alternativas.map((e) => aHueco(e, "alternativa"))];
  const sugeridas = sugerirPropuesta(bloques, { alternativasPrimero: b.alternativasPrimero, horaPedida, max: modo === "cercania" ? MAX_HUECOS : p.max ?? MAX_HUECOS });
  const ampliado: Ampliacion = b.cumplen.length > 0 ? null : "todo";
  const nota = notaBloques(b, p.preferencia, horaPedida);
  if (modo === "cercania") return { ...salida(bloques, ampliado, nota), alternativasPrimero: b.alternativasPrimero, sugeridas };
  return { ...salida(sugeridas, ampliado, nota), alternativasPrimero: b.alternativasPrimero };
}

/** La identidad de un hueco: mismo día, misma hora, mismo doctor. */
export const mismoHueco = (a: Pick<HuecoDelCaso, "fecha" | "hora" | "doctorId">, b: Pick<HuecoDelCaso, "fecha" | "hora" | "doctorId">): boolean =>
  a.fecha === b.fecha && a.hora === b.hora && a.doctorId === b.doctorId;

// Para el QA sin base: la escalera y el casado son puros y se prueban solos.
export const _interno = { enFranja, notaBloques, CERCA_HORA_MIN, DIAS_CUMPLEN, DIAS_ALTERNATIVAS, VENTANA_SELECTOR, FIN_MANANA_MIN };
