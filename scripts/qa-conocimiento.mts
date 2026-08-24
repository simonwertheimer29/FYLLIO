#!/usr/bin/env tsx
// QA del CONOCIMIENTO DE CLÍNICA (fase D, grupo 2) — determinista, SIN modelo.
//
//   npx tsx scripts/qa-conocimiento.mts   (= npm run qa:conocimiento)
//
//   A · parseConocimiento: NULL/vacío → vacío en silencio; ilegible LANZA
//       (jamás cae al default); forma estricta campo a campo.
//   B · EL ASSERT DEL PLAN BÁSICO (condición dictada 22-08, desde el PRIMER
//       commit): el prompt ensamblado con config vacía es BYTE A BYTE el
//       mismo que sin configuración. Si esto rompe, el plan básico se
//       degradó sin que nadie lo eligiera.
//   C · renderConocimiento con datos: precios tal cual, aviso «sin precio
//       publicado», la frontera (adaptar se anota) en cabecera.
//
// Puro de punta a punta: sin DB, sin red. Salidas §9: 0 · 1.

import {
  parseConocimiento,
  renderConocimiento,
  esConocimientoVacio,
  plazosParaReloj,
  horarioLegible,
  CONOCIMIENTO_VACIO,
  ConocimientoIlegibleError,
} from "../app/lib/agente/conocimiento";

/** Horario válido de referencia para los checks del grupo 4 (con sábado). */
const dia = { activo: true, inicio: "09:00", fin: "20:00" };
const HORARIO_QA = {
  lunes: { ...dia }, martes: { ...dia }, miercoles: { ...dia }, jueves: { ...dia },
  viernes: { ...dia }, sabado: { activo: true, inicio: "10:00", fin: "14:00" },
  domingo: { activo: false, inicio: "10:00", fin: "14:00" },
};
import { renderEntrada, type EntradaEvaluador } from "../app/lib/agente/evaluador";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};
const lanza = (raw: string): boolean => {
  try {
    parseConocimiento(raw);
    return false;
  } catch (e) {
    return e instanceof ConocimientoIlegibleError;
  }
};

// ─── A · El parser ─────────────────────────────────────────────────────────
console.log("\nA · parseConocimiento: vacío en silencio, ilegible lanza");

ok("NULL → vacío en silencio (el estado normal de una clínica sin configurar)",
  esConocimientoVacio(parseConocimiento(null)) && esConocimientoVacio(parseConocimiento("")));
ok("JSON roto LANZA ConocimientoIlegibleError — jamás cae al default",
  lanza("{esto no es json"));
ok("forma equivocada (array, o tratamiento sin nombre) LANZA",
  lanza("[1,2]") && lanza(JSON.stringify({ tratamientos: [{ precio: "600 €" }] })));
ok("un enlace sin http(s) LANZA — un enlace roto en boca del agente es peor que ninguno",
  lanza(JSON.stringify({ enlaces: [{ etiqueta: "Reserva", url: "javascript:alert(1)" }] })));

const bueno = parseConocimiento(JSON.stringify({
  tratamientos: [
    { nombre: "Ortodoncia invisible", precio: "desde 35 €/mes", nota: "financiación 24 meses" },
    { nombre: "Blanqueamiento", precio: null, nota: null },
  ],
  politicas: [{ titulo: "Seguros", texto: "Trabajamos con Sanitas y Adeslas" }],
  plazos: { horario: HORARIO_QA },
  enlaces: [{ etiqueta: "Reserva online", url: "https://clinica.example/reserva" }],
}));
ok("una config válida se parsea entera, con los textos recortados",
  bueno.tratamientos.length === 2 && bueno.tratamientos[0].precio === "desde 35 €/mes" &&
    bueno.politicas.length === 1 && bueno.plazos.horario != null && bueno.enlaces.length === 1);
ok("campos ausentes = secciones vacías, no error (se publica por partes)",
  !lanza(JSON.stringify({ enlaces: [] })) &&
    parseConocimiento(JSON.stringify({ enlaces: [] })).tratamientos.length === 0);
ok("agenda: ausente → nivel 1 (sin conexión), el único que existe",
  parseConocimiento(JSON.stringify({ enlaces: [] })).agendaNivel === 1);
ok("agenda: nivel 2 guardado HOY se rechaza — prometería huecos que el agente no ve (MEJORAS 97)",
  lanza(JSON.stringify({ agendaNivel: 2 })) && lanza(JSON.stringify({ agendaNivel: 3 })));

// Grupos 1 y 3 (22-08):
ok("grupo 3: umbral de insistencia CON TOPE — 0 y 5 se rechazan, 1–4 pasan",
  lanza(JSON.stringify({ alcance: { umbralInsistencia: 0 } })) &&
    lanza(JSON.stringify({ alcance: { umbralInsistencia: 5 } })) &&
    parseConocimiento(JSON.stringify({ alcance: { umbralInsistencia: 3 } })).alcance.umbralInsistencia === 3);
ok("grupo 3: «no atendemos urgencias» SIN texto literal se rechaza — el modelo no improvisa ese mensaje",
  lanza(JSON.stringify({ alcance: { urgencias: { atiende: false } } })) &&
    parseConocimiento(JSON.stringify({ alcance: { urgencias: { atiende: false, textoNoAtiende: "Llama al 112" } } }))
      .alcance.urgencias?.textoNoAtiende === "Llama al 112");
ok("grupo 1: trato solo tu | usted",
  lanza(JSON.stringify({ quienesSois: { trato: "vos" } })) &&
    parseConocimiento(JSON.stringify({ quienesSois: { trato: "usted" } })).quienesSois.trato === "usted");
ok("grupo 4: umbrales con TOPE (urgencia 5 y 200 se rechazan; 45 pasa)",
  lanza(JSON.stringify({ plazos: { urgenciaMin: 5 } })) &&
    lanza(JSON.stringify({ plazos: { urgenciaMin: 200 } })) &&
    parseConocimiento(JSON.stringify({ plazos: { urgenciaMin: 45 } })).plazos.urgenciaMin === 45);
ok("grupo 4: un horario que cierra antes de abrir, o sin ningún día activo, se rechaza",
  lanza(JSON.stringify({ plazos: { horario: { ...HORARIO_QA, lunes: { activo: true, inicio: "20:00", fin: "09:00" } } } })) &&
    lanza(JSON.stringify({ plazos: { horario: Object.fromEntries(Object.keys(HORARIO_QA).map((d) => [d, { activo: false, inicio: "09:00", fin: "20:00" }])) } })));
{
  const p = parseConocimiento(JSON.stringify({ plazos: { respuestaMin: 480, horario: HORARIO_QA } }));
  const reloj = plazosParaReloj(p);
  ok("grupo 4: plazosParaReloj mapea umbrales por obligación y entrega el horario",
    reloj.umbralesMin.respuesta === 480 && reloj.umbralesMin.urgencia === undefined &&
      reloj.horario?.sabado.activo === true);
}
ok("horarioLegible agrupa días contiguos con el mismo tramo y omite los cerrados",
  horarioLegible(HORARIO_QA) === "lun–vie 9:00–20:00 · sáb 10:00–14:00" &&
    horarioLegible({ ...HORARIO_QA, miercoles: { activo: false, inicio: "09:00", fin: "20:00" } }) ===
      "lun–mar 9:00–20:00 · jue–vie 9:00–20:00 · sáb 10:00–14:00");

// ─── B · EL ASSERT DEL PLAN BÁSICO ─────────────────────────────────────────
console.log("\nB · plan básico: prompt con config vacía ≡ prompt de hoy, byte a byte");

const entradaBase: EntradaEvaluador = {
  nombre: "Elena García",
  esPacienteConocido: true,
  objetivosAbiertos: [],
  presupuestosVivos: [{ id: "p1", tratamiento: "Endodoncia", importe: 650 }],
  pendienteCobro: 0,
  hilo: [
    { direccion: "Entrante", contenido: "Hola, ¿cuánto cuesta una limpieza?", timestamp: "2026-08-22T10:00:00Z" },
  ],
  aplazadosPendientes: [],
  aplazadosPorClave: {},
  yaDerivado: false,
  hoy: "2026-08-22",
};
const sinCampo = renderEntrada(entradaBase).texto;
const conVacio = renderEntrada({ ...entradaBase, conocimiento: CONOCIMIENTO_VACIO }).texto;
const conNull = renderEntrada({ ...entradaBase, conocimiento: null }).texto;
ok("conocimiento ausente ≡ CONOCIMIENTO_VACIO ≡ null — ni un byte de diferencia",
  sinCampo === conVacio && sinCampo === conNull);
ok("y el prompt de hoy NO menciona lo publicado (sonda del assert: si esto falla, el assert no afirma nada)",
  !sinCampo.includes("LO PUBLICADO POR LA CLÍNICA"));

// ─── C · El render con datos ───────────────────────────────────────────────
console.log("\nC · con datos: lo publicado entra tal cual, con su frontera");

const conDatos = renderEntrada({ ...entradaBase, conocimiento: bueno }).texto;
ok("el bloque aparece con la frontera en cabecera (afirmar sí; adaptar se anota)",
  conDatos.includes("LO PUBLICADO POR LA CLÍNICA") && conDatos.includes("se anota siempre"));
ok("el precio publicado viaja TAL CUAL («desde 35 €/mes» — texto, no number)",
  conDatos.includes("Ortodoncia invisible: desde 35 €/mes"));
ok("un tratamiento sin precio lo dice: «sin precio publicado — no des cifra»",
  conDatos.includes("Blanqueamiento (sin precio publicado — no des cifra)"));
ok("horario (DERIVADO del único dato; 23-08: se presenta como APERTURA, no como huecos), políticas y enlaces presentes",
  conDatos.includes("Horario de APERTURA (cuándo abre la clínica): lun–vie 9:00–20:00 · sáb 10:00–14:00") &&
    conDatos.includes("NO son huecos libres") &&
    conDatos.includes("Sanitas") &&
    conDatos.includes("https://clinica.example/reserva"));
ok("y el resto del prompt no cambió (todo lo de antes sigue: presupuesto, hilo, calendario)",
  conDatos.includes("Endodoncia") && conDatos.includes("CALENDARIO") &&
    conDatos.includes("cuánto cuesta una limpieza"));

// ─── D · Grupos 1 y 3 en el render ─────────────────────────────────────────
console.log("\nD · identidad y alcance en el bloque");

const conIdentidad = parseConocimiento(JSON.stringify({
  quienesSois: { presentacion: "Clínica familiar en Chamberí, 20 años en el barrio", trato: "usted" },
  alcance: { urgenciaDefinicionExtra: "dolor postoperatorio de implante" },
}));
const rIdentidad = renderConocimiento(conIdentidad).join("\n");
ok("la identidad va PRIMERO (quién habla antes de qué afirma) y el trato de usted se dice",
  rIdentidad.startsWith("QUIÉNES SOIS") && rIdentidad.includes("USTED"));
ok("la urgencia extra SE SUMA a la base («además de la definición base»)",
  rIdentidad.includes("además de la definición base") && rIdentidad.includes("dolor postoperatorio"));
ok("sin nada PUBLICADO, la cabecera «LO PUBLICADO» no aparece — un título sin contenido es ruido",
  !rIdentidad.includes("LO PUBLICADO POR LA CLÍNICA"));
ok("y el assert del plan básico SIGUE: los campos nuevos en null no emiten ni un byte",
  renderConocimiento(parseConocimiento(JSON.stringify({ quienesSois: {}, alcance: {} }))).length === 0);

// ─── D2 · La política de cobro (F5) ────────────────────────────────────────
console.log("\nD2 · política de cobro: topes del parser y defaults 7/30");

const { politicaCobro, POLITICA_COBRO_DEFAULT } = await import("../app/lib/agente/conocimiento");
ok("sin configurar → los defaults dictados (7 días vencido, 30 a Fuera de plazo)",
  politicaCobro(parseConocimiento(null)).vencidoDias === 7 &&
  politicaCobro(parseConocimiento(null)).fueraDePlazoDias === 30 &&
  POLITICA_COBRO_DEFAULT.vencidoDias === 7);
ok("configurada → la de la clínica (14/60)",
  (() => { const c = parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 14, cobroFueraDePlazoDias: 60 } }));
    return politicaCobro(c).vencidoDias === 14 && politicaCobro(c).fueraDePlazoDias === 60; })());
ok("fuera de tope se RECHAZA (61 días vencido; 181 escalada) — fail-closed, no se recorta",
  (() => { try { parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 61 } })); return false; } catch { }
    try { parseConocimiento(JSON.stringify({ plazos: { cobroFueraDePlazoDias: 181 } })); return false; } catch { return true; } })());
ok("escalada ≤ vencido se RECHAZA (30/30): escalar antes de vencer no significa nada",
  (() => { try { parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 30, cobroFueraDePlazoDias: 30 } })); return false; } catch { return true; } })());
ok("el plan básico NO cambia: los campos nuevos en null no emiten ni un byte al prompt",
  renderConocimiento(parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 10, cobroFueraDePlazoDias: 40 } }))).length === 0);

// ─── E · El veto determinista de agenda (23-08) ────────────────────────────
//
// El fallo «tenemos disponibilidad…» volvió TRES veces por tres puertas; la
// tercera fue el ECO DEL HORARIO («Tenemos disponibilidad por las tardes de
// lunes a viernes, de 17:00 a 20:00») — el generador convertía la apertura en
// huecos y el juez lo eximía porque el rango constaba. El cierre de raíz es
// CÓDIGO: estas frases-firma no salen nunca en nivel 1, obedezca quien
// obedezca. Los tres casos históricos se prueban LITERALES.
console.log("\nE · veto determinista de agenda: las frases-firma no salen");

const { vetoAgendaDeterminista } = await import("../app/lib/agente/juez-borrador");
const veta = (b: string) => vetoAgendaDeterminista(b) != null;

ok("caso 1 (huecos inventados): «tenemos hueco el martes a las 16:00» → vetado",
  veta("Tenemos hueco el martes a las 16:00, ¿te viene bien?"));
ok("caso 2 (eco de disponibilidad): «tenemos disponibilidad los martes y jueves» → vetado",
  veta("¡Perfecto! Tenemos disponibilidad los martes y jueves por la tarde."));
ok("caso 3, LA CAPTURA DEL 23-08 (eco del horario): «Tenemos disponibilidad por las tardes de lunes a viernes, de 17:00 a 20:00» → vetado",
  veta("Tenemos disponibilidad por las tardes de lunes a viernes, de 17:00 a 20:00. ¿Qué día te viene bien?"));
ok("variantes: «hay disponibilidad a partir de las 16:00» y «nos queda un hueco» → vetadas",
  veta("Hay disponibilidad a partir de las 16:00.") && veta("Nos queda un hueco el jueves."));
ok("reservar-él: «te cierro la cita» y «queda agendada» → vetadas SIEMPRE",
  veta("Dime qué día y te cierro la cita.") && veta("Queda agendada tu cita para el martes."));
ok("la apertura dicha COMO apertura pasa: «abrimos de 17:00 a 20:00» no es afirmar huecos",
  !veta("Abrimos de lunes a viernes de 17:00 a 20:00. ¿Qué días y franjas te vienen bien?"));
ok("recoger la disponibilidad DE LA PERSONA pasa: preguntar no es afirmar",
  !veta("¿Qué disponibilidad tienes esta semana?") &&
  !veta("En cuanto me digas tu disponibilidad, se lo paso al equipo."));
ok("anunciar al EQUIPO pasa: «el equipo te confirma la cita» no la reserva el agente",
  !veta("Se lo paso al equipo y te confirman la cita enseguida.") &&
  !veta("Te buscamos hueco por las tardes y te decimos algo hoy."));
ok("nivel 2 (huecosConstan): la disponibilidad se permite, reservar-él se veta IGUAL",
  vetoAgendaDeterminista("Tenemos hueco el martes a las 16:00.", { huecosConstan: true }) == null &&
  vetoAgendaDeterminista("Te reservo el martes a las 16:00.", { huecosConstan: true }) != null);

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ conocimiento: parser fail-closed, plan básico intacto byte a byte, y lo publicado entra tal cual");
