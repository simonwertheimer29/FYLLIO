// app/lib/agenda/ofertas-textos.ts
//
// LOS TEXTOS AL PACIENTE DEL BUCLE DE OFERTAS (17-09). Plantillas de CÓDIGO,
// puras (sin base, sin modelo): las importa el motor (ofertas.ts), el
// evaluador (la desambiguación) y el QA. Lo que dicen depende de hechos que
// solo el código garantiza (qué se ofreció, qué se ocupó, que alguien lo
// mira), por eso no las redacta el modelo ni pasan por el juez.
//
// Aprobados por Simon el 17-09, todos: la oferta («te la reservamos» + orden
// de confirmación), «se acaba de ocupar», «todas ocupadas» (con y sin horas
// nuevas), la desambiguación por horas y el acuse con sus dos ramas.

import { fechaClinica } from "../time";
import type { HuecoDelCaso } from "./huecos-del-caso";

export type Alternativa = HuecoDelCaso;

const nombreDe = (nombre: string): string => {
  const n = nombre.trim().split(/\s+/)[0] ?? "";
  return n.length > 1 && !/\d/.test(n) ? `${n}, ` : "";
};

const enMinuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** «jue 18 sept a las 10:00 con Dra. Ana Villalba» */
export function alternativaLegible(a: Pick<Alternativa, "fecha" | "hora" | "doctorNombre">): string {
  const dia = fechaClinica(a.fecha, { diaSemana: true });
  return `${dia} a las ${a.hora}${a.doctorNombre ? ` con ${a.doctorNombre}` : ""}`;
}

/** «la del jueves a las 10:00» */
export function alternativaCorta(a: Pick<Alternativa, "fecha" | "hora">): string {
  const dia = fechaClinica(a.fecha, { diaSemana: true, mesLargo: true }).split(" ")[0] ?? "";
  const nombreDia: Record<string, string> = { lunes: "lunes", martes: "martes", miércoles: "miércoles", jueves: "jueves", viernes: "viernes", sábado: "sábado", domingo: "domingo" };
  const d = nombreDia[dia] ?? fechaClinica(a.fecha, { diaSemana: true });
  return `la del ${d} a las ${a.hora}`;
}

const lista = (alts: readonly Alternativa[]) => alts.map((a, i) => `${i + 1}) ${alternativaLegible(a)}`).join("\n");

/** LA OFERTA. Sin frase final que dé permiso a no elegir; el aviso de que las
 *  horas pueden cambiar va del derecho (se asignan por orden de confirmación),
 *  no como excusa. Texto pendiente del OK de Simon (el resto de la línea,
 *  «Dinos cuál te va y queda reservada para ti», es el aprobado). */
export function textoOferta(p: { nombre: string; alternativas: readonly Alternativa[]; tratamiento: string | null }): string {
  const que = p.tratamiento ? ` para ${enMinuscula(p.tratamiento)}` : "";
  return `${nombreDe(p.nombre)}estas son las horas que tenemos${que}:\n${lista(p.alternativas)}\nDinos cuál te va y te la reservamos. Las horas se asignan por orden de confirmación, así que cuanto antes nos digas, antes la tienes.`;
}

/** «Se acaba de ocupar» — SIN «Vaya» (es fallo nuestro). Aprobado. */
export function textoSeOcupo(p: { nombre: string; ocupada: Alternativa; restantes: readonly Alternativa[] }): string {
  return `${nombreDe(p.nombre)}${alternativaCorta(p.ocupada)} se acaba de ocupar. Te quedan estas:\n${lista(p.restantes)}\nDinos cuál te va y queda reservada para ti.`;
}

/** Se ocuparon TODAS y hay otras. Aprobado. */
export function textoTodasOcupadas(p: { nombre: string; nuevas: readonly Alternativa[] }): string {
  return `${nombreDe(p.nombre)}las horas que te propusimos se han ocupado mientras tanto. Te paso otras:\n${lista(p.nuevas)}\nDinos cuál y queda reservada para ti.`;
}

/** Se ocuparon TODAS y no hay otras (opción b, aprobada): el caso vuelve a la
 *  coordinadora con plazo «al abrir la clínica». */
export function textoSinHuecos(p: { nombre: string }): string {
  return `${nombreDe(p.nombre)}las horas que te propusimos se han ocupado y ahora mismo no tenemos otras en los próximos días. El equipo revisa la agenda y te escribe en cuanto abra la clínica.`;
}

/** «la del jueves 24 a las 10:00 con la Dra. Villalba» — con el número del
 *  día y el artículo del doctor, para nombrar la hora sin números de lista. */
export function alternativaNombrada(a: Pick<Alternativa, "fecha" | "hora" | "doctorNombre">): string {
  const dia = fechaClinica(a.fecha, { diaSemana: true, mesLargo: true }); // «jueves 24 de septiembre»
  const diaNum = dia.replace(/ de .*$/, "");
  const doc = a.doctorNombre ? ` con ${/^dra\.?\s/i.test(a.doctorNombre) ? "la " : /^dr\.?\s/i.test(a.doctorNombre) ? "el " : ""}${a.doctorNombre}` : "";
  return `la del ${diaNum} a las ${a.hora}${doc}`;
}

/** El agente pide aclarar cuál: SOLO repite lo que ya salió (correa corta),
 *  por sus HORAS y no por números (aprobado por Simon el 17-09: si el primer
 *  mensaje decía 1, 2 y 3 y aquí se repiten dos como 1 y 2, el «2» ya no es
 *  el mismo), y sin prometer que queda reservada (entre que contesta y la
 *  coordinadora reserva, el hueco puede ocuparse). */
export function textoDesambiguacion(p: { nombre: string; alternativas: readonly Alternativa[] }): string {
  const n = p.alternativas.length;
  const cuantas = n === 2 ? "de las dos" : n === 3 ? "de las tres" : n === 4 ? "de las cuatro" : "de estas";
  const nombradas = p.alternativas.map(alternativaNombrada);
  const enumeradas = nombradas.length > 1 ? `${nombradas.slice(0, -1).join(", ")} o ${nombradas[nombradas.length - 1]}` : nombradas[0] ?? "";
  const cap = enumeradas.charAt(0).toUpperCase() + enumeradas.slice(1);
  return `${nombreDe(p.nombre)}¿cuál ${cuantas} dices? ${cap}.`;
}

/** EL ACUSE (aprobado con dos ramas por horario). No promete hora ni
 *  confirma nada; sin alternativa conocida (no se entendió cuál, o el hilo
 *  lo lleva una persona y no se interpretó) va sin la hora. */
export function textoAcuse(p: { nombre: string; alternativa: Alternativa | null; abierta: boolean }): string {
  const cuando = p.abierta ? "en un momento" : "en cuanto abra la clínica";
  const n = nombreDe(p.nombre);
  const saludo = n ? `Recibido, ${n.slice(0, -2)}. ` : "Recibido. ";
  return p.alternativa
    ? `${saludo}Compruebo que ${alternativaCorta(p.alternativa)} siga libre y te lo confirmamos ${cuando}.`
    : `${saludo}Lo comprobamos en la agenda y te lo confirmamos ${cuando}.`;
}

