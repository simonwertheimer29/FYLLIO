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
  CONOCIMIENTO_VACIO,
  ConocimientoIlegibleError,
} from "../app/lib/agente/conocimiento";
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
  horarios: "L-V 9:30–20:00, sábados 10–14",
  enlaces: [{ etiqueta: "Reserva online", url: "https://clinica.example/reserva" }],
}));
ok("una config válida se parsea entera, con los textos recortados",
  bueno.tratamientos.length === 2 && bueno.tratamientos[0].precio === "desde 35 €/mes" &&
    bueno.politicas.length === 1 && bueno.horarios != null && bueno.enlaces.length === 1);
ok("campos ausentes = secciones vacías, no error (se publica por partes)",
  !lanza(JSON.stringify({ horarios: "L-V 9-20" })) &&
    parseConocimiento(JSON.stringify({ horarios: "L-V 9-20" })).tratamientos.length === 0);
ok("agenda: ausente → nivel 1 (sin conexión), el único que existe",
  parseConocimiento(JSON.stringify({ horarios: "L-V 9-20" })).agendaNivel === 1);
ok("agenda: nivel 2 guardado HOY se rechaza — prometería huecos que el agente no ve (MEJORAS 97)",
  lanza(JSON.stringify({ agendaNivel: 2 })) && lanza(JSON.stringify({ agendaNivel: 3 })));

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
ok("horario, políticas y enlaces presentes",
  conDatos.includes("L-V 9:30–20:00") && conDatos.includes("Sanitas") &&
    conDatos.includes("https://clinica.example/reserva"));
ok("y el resto del prompt no cambió (todo lo de antes sigue: presupuesto, hilo, calendario)",
  conDatos.includes("Endodoncia") && conDatos.includes("CALENDARIO") &&
    conDatos.includes("cuánto cuesta una limpieza"));

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ conocimiento: parser fail-closed, plan básico intacto byte a byte, y lo publicado entra tal cual");
