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

/** Ventana de búsqueda: dos semanas. Más allá, ofrecer un hueco a quien dijo
 *  «cuanto antes» no es ayudarle. */
const VENTANA_DIAS = 14;
const MAX_HUECOS = 3;
/** Hoy solo cuentan los huecos que empiezan al menos una hora después de ahora. */
const MARGEN_HOY_MIN = 60;
/** «Mañana» termina a las 14:00 (uso clínico español). */
const FIN_MANANA_MIN = 14 * 60;

const DIA_ISO: Record<DiaSemana, number> = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7 };

export type HuecoDelCaso = {
  fecha: string;
  hora: string;
  fin: string;
  doctorId: string;
  doctorNombre: string;
  clinicaId: string | null;
  clinicaNombre: string | null;
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
  doctorFiltrado: { id: string; nombre: string } | null;
  /** El doctor asignado al lead no es de la clínica del caso: se ignoró. */
  doctorFueraDeClinica: string | null;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Casa el tratamiento que DIJO la persona con el catálogo por nombre: «una
 *  limpieza» ↔ «Limpieza dental». Inclusión en cualquier sentido de la
 *  palabra más larga; si casan varios, ninguno (se pide elegir). */
export function casarTratamiento<T extends { id: string; nombre: string; duracionMin: number }>(
  texto: string | null,
  catalogo: readonly T[],
): T | null {
  if (!texto) return null;
  const palabras = norm(texto).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (palabras.length === 0) return null;
  const candidatos = catalogo.filter((t) => {
    const n = norm(t.nombre);
    return palabras.some((w) => n.includes(w)) || n.split(/[^a-z0-9]+/).some((w) => w.length >= 4 && palabras.includes(w));
  });
  return candidatos.length === 1 ? candidatos[0]! : null;
}

function enFranja(inicioMin: number, franja: PreferenciaCita["franja"]): boolean {
  if (!franja || franja === "indiferente") return true;
  return franja === "manana" ? inicioMin < FIN_MANANA_MIN : inicioMin >= FIN_MANANA_MIN;
}

type SlotDia = { fecha: string; slot: IntervaloMin; doctorId: string };

/** PURA: aplica la preferencia con la escalera de ampliación y devuelve los
 *  primeros N en orden (día preferido primero; dentro, fecha y hora). */
export function elegirHuecos(
  slots: readonly SlotDia[],
  pref: PreferenciaCita | null,
  max = MAX_HUECOS,
): { elegidos: SlotDia[]; ampliado: Ampliacion } {
  const dias = pref?.dias ?? [];
  const franja = pref?.franja ?? null;
  const porFecha = (a: SlotDia, b: SlotDia) => a.fecha.localeCompare(b.fecha) || a.slot.inicio - b.slot.inicio;
  const conDias = (s: readonly SlotDia[]) => {
    if (dias.length === 0) return [...s].sort(porFecha);
    // Orden de preferencia de días: todos los jueves antes que cualquier lunes.
    const rango = new Map(dias.map((d, i) => [DIA_ISO[d], i]));
    return s
      .filter((x) => rango.has(diaSemanaISO(x.fecha)))
      .sort((a, b) => rango.get(diaSemanaISO(a.fecha))! - rango.get(diaSemanaISO(b.fecha))! || porFecha(a, b));
  };
  const conFranja = (s: readonly SlotDia[]) => s.filter((x) => enFranja(x.slot.inicio, franja));

  const escalera: Array<[Ampliacion, SlotDia[]]> = [
    [null, conDias(conFranja(slots))],
    ["franja", conDias(slots)],
    ["dias", [...conFranja(slots)].sort(porFecha)],
    ["todo", [...slots].sort(porFecha)],
  ];
  const hayPref = dias.length > 0 || (franja != null && franja !== "indiferente");
  for (const [amp, lista] of escalera) {
    if (!hayPref && amp !== null) break;
    if (lista.length > 0) return { elegidos: lista.slice(0, max), ampliado: amp };
  }
  return { elegidos: [], ampliado: null };
}

function notaDe(ampliado: Ampliacion, pref: PreferenciaCita | null, vacio: boolean): string | null {
  const franjaTxt = pref?.franja === "manana" ? "por la mañana" : pref?.franja === "tarde" ? "por la tarde" : null;
  const diasTxt = pref?.dias?.length ? `los ${pref.dias.map((d) => ({ lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábados", dom: "domingos" })[d]).join(" o ")}` : null;
  const lo = [diasTxt, franjaTxt].filter(Boolean).join(" ");
  if (vacio) return `Sin huecos en las próximas dos semanas${lo ? ` (pidió ${lo})` : ""}. Mira toda la agenda.`;
  if (ampliado === "franja") return `No hay ${franjaTxt} ${diasTxt ?? ""} en dos semanas: estos son ${diasTxt ?? "esos días"} a otra hora.`.replace(/\s+/g, " ");
  if (ampliado === "dias") return `No hay ${diasTxt} ${franjaTxt ?? ""} en dos semanas: estos son otros días ${franjaTxt ?? ""}.`.replace(/\s+/g, " ");
  if (ampliado === "todo") return `No hay nada ${lo} en dos semanas: estos son los más cercanos.`;
  return null;
}

export async function huecosDelCaso(p: {
  preferencia: PreferenciaCita | null;
  /** Lo que dijo la persona que quiere («una limpieza»), para casar con el catálogo. */
  tratamientoTexto: string | null;
  /** Elegido a mano en el panel; manda sobre el casado. */
  tratamientoId: string | null;
  /** Doctor asignado al lead; null = todos los que tienen horario. */
  doctorId: string | null;
  /** LA CLÍNICA DEL CASO (17-09, bug grave visto por Simon): solo se ofrecen
   *  doctores de ESTA clínica. El lead de Centro tenía asignado un doctor de
   *  Norte y la confirmación decía «tu cita en Clínica Demo Norte». null =
   *  sin clínica conocida: todas (se dice en la nota). */
  clinicaId: string | null;
  hoy?: string;
  ahora?: Date;
}): Promise<RespuestaHuecos> {
  const cliente = requireCliente("huecosDelCaso");
  const ahora = p.ahora ?? new Date();
  const hoy = p.hoy ?? hoyISO(ahora);
  const fechas = Array.from({ length: VENTANA_DIAS }, (_, i) => (i === 0 ? hoy : sumaDias(hoy, i)));
  const desdeUTC = inicioDelDiaUTC(hoy);
  const hastaUTC = inicioDelDiaUTC(sumaDias(hoy, VENTANA_DIAS));

  const d = await runWithClienteDb(cliente, async (trx) => {
    const agendaEnFyllio = await leerAgendaEnFyllio(trx);
    const staff = await trx
      .selectFrom("staff")
      .leftJoin("clinicas", (j) => j.onRef("clinicas.id", "=", "staff.clinica_id"))
      .select(["staff.id", "staff.nombre", "staff.rol", "staff.activo", "staff.clinica_id", "clinicas.nombre as clinica_nombre"])
      .execute();
    const horarios = await trx.selectFrom("horarios_staff").select(["staff_id", "dia_semana", "inicio", "fin"]).execute();
    const catalogo = await trx.selectFrom("tratamientos").select(["id", "nombre", "duracion_min", "buffer_antes_min", "buffer_despues_min"]).orderBy("nombre").execute();
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
    return { agendaEnFyllio, staff, horarios, catalogo, bloqueos, citas, agendasExternas, ocupaciones };
  });

  const catalogo = d.catalogo
    .filter((t: any) => Number.isInteger(t.duracion_min) && t.duracion_min > 0)
    .map((t: any) => ({ id: t.id as string, nombre: (t.nombre ?? "") as string, duracionMin: t.duracion_min as number, antes: t.buffer_antes_min ?? 0, despues: t.buffer_despues_min ?? 0 }));
  const tratamiento = p.tratamientoId ? catalogo.find((t) => t.id === p.tratamientoId) ?? null : casarTratamiento(p.tratamientoTexto, catalogo);

  const dentistasDeLaClinica = d.staff.filter(
    (s: any) => (s.rol ?? "") === "Dentista" && s.activo !== false && (!p.clinicaId || s.clinica_id === p.clinicaId),
  );
  // Un doctor asignado de OTRA clínica no filtra: se ofrecen los de la clínica
  // del caso y se avisa (`doctorFueraDeClinica`).
  const asignadoEnClinica = p.doctorId ? dentistasDeLaClinica.find((s: any) => s.id === p.doctorId) ?? null : null;
  const doctorFueraDeClinica = p.doctorId != null && asignadoEnClinica == null
    ? (d.staff.find((s: any) => s.id === p.doctorId)?.nombre ?? p.doctorId)
    : null;
  const doctores = asignadoEnClinica ? [asignadoEnClinica] : dentistasDeLaClinica;
  const doctorFiltrado = asignadoEnClinica;
  const horariosDe = new Map<string, Array<{ dia_semana: number; inicio: string; fin: string }>>();
  for (const h of d.horarios) horariosDe.set(h.staff_id, [...(horariosDe.get(h.staff_id) ?? []), h]);

  // Doctores implicados = con horario. Los de agenda externa rota se apartan.
  const externasDe = new Map<string, typeof d.agendasExternas>();
  for (const a of d.agendasExternas) externasDe.set(a.staff_id, [...(externasDe.get(a.staff_id) ?? []), a]);
  const implicados = doctores.filter((s: any) => (horariosDe.get(s.id) ?? []).length > 0);
  const rotos = new Set(implicados.filter((s: any) => (externasDe.get(s.id) ?? []).some((a) => !a.ultimo_sync_ok || a.ultimo_error)).map((s: any) => s.id));
  const garantia = garantiaDe({
    agendaEnFyllio: d.agendaEnFyllio,
    externas: implicados.flatMap((s: any) => (externasDe.get(s.id) ?? []).map((a) => ({ staffId: s.nombre ?? s.id, fuente: a.fuente, ultimoSyncOk: a.ultimo_sync_ok, ultimoError: a.ultimo_error }))),
  });

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
  });

  if (!tratamiento) return salida([], null, catalogo.length ? "Elige el tipo de cita: su duración define los huecos." : "Ningún tratamiento tiene duración configurada — sin ella no se calculan huecos (Ajustes → Agenda).");
  if (implicados.length === 0) return salida([], null, doctorFiltrado ? `${doctorFiltrado.nombre} no tiene horario configurado — sin él no se calculan huecos.` : "Ningún doctor tiene horario configurado (Ajustes → Agenda).");

  const slots: SlotDia[] = [];
  const minHoy = aMin(horaClinica(ahora)) + MARGEN_HOY_MIN;
  for (const doc of implicados) {
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
      const libres = disponibilidadDia({ franjas, ocupaciones: ocup });
      for (const s of trocearEnSlots(libres, { duracionMin: tratamiento.duracionMin, bufferAntesMin: tratamiento.antes, bufferDespuesMin: tratamiento.despues })) {
        if (fecha === hoy && s.inicio < minHoy) continue;
        slots.push({ fecha, slot: s, doctorId: doc.id });
      }
    }
  }

  const { elegidos, ampliado } = elegirHuecos(slots, p.preferencia);
  const nombreDe = new Map(implicados.map((s: any) => [s.id, s]));
  const huecos = elegidos.map((e) => {
    const s: any = nombreDe.get(e.doctorId);
    return { fecha: e.fecha, hora: deMin(e.slot.inicio), fin: deMin(e.slot.fin), doctorId: e.doctorId, doctorNombre: s?.nombre ?? "", clinicaId: s?.clinica_id ?? null, clinicaNombre: s?.clinica_nombre ?? null };
  });
  return salida(huecos, ampliado, notaDe(ampliado, p.preferencia, huecos.length === 0));
}

// Para el QA sin base: la escalera y el casado son puros y se prueban solos.
export const _interno = { enFranja, notaDe };
