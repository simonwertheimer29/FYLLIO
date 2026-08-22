#!/usr/bin/env tsx
// MEDICIÓN de coste por turno del agente (encargo 22-08, PLAN §6): prompt
// COMPLETO (grupo 2 cargado) contra el GENÉRICO de hoy — medido, no estimado.
//
//   npx tsx scripts/medir-coste-agente.mts
//
// Corre evaluarTurno (evaluador + juez, el camino real de producción) sobre
// una conversación de 3 turnos, dos veces: sin conocimiento y con una config
// realista del grupo 2. Reporta por turno, por conversación de 3 turnos y al
// mes con 1.000 conversaciones — y el efecto del prompt caching por separado
// (escritura 1.25× · lectura 0.1×), que es donde está el dinero.
//
// Precios Haiku 4.5 (el modelo de producción): $1/M input · $5/M output ·
// $1.25/M cache write · $0.10/M cache read.
//
// Coste de ESTA medición: 6 turnos de Haiku (~$0.01). Salidas §9: 0 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { evaluarTurno, type EntradaEvaluador, type MensajeHilo } from "../app/lib/agente/evaluador";
import { OBJETIVOS_POR_DEFECTO } from "../app/lib/automatizacion/objetivos";
import { parseConocimiento } from "../app/lib/agente/conocimiento";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ Falta ANTHROPIC_API_KEY — no se puede medir.");
  process.exit(2);
}

const PRECIO = { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 }; // $/M tokens

const CONOCIMIENTO = parseConocimiento(JSON.stringify({
  tratamientos: [
    { nombre: "Ortodoncia invisible", precio: "desde 35 €/mes", nota: "financiación 24 meses sin intereses" },
    { nombre: "Implante unitario", precio: "desde 1.200 €", nota: "incluye corona" },
    { nombre: "Blanqueamiento LED", precio: "295 €", nota: null },
    { nombre: "Higiene bucodental", precio: "49 €", nota: null },
    { nombre: "Primera visita y valoración", precio: "gratuita", nota: "incluye radiografía" },
  ],
  politicas: [
    { titulo: "Vías de pago", texto: "Efectivo, tarjeta y financiación hasta 24 meses sin intereses (sujeta a aprobación)" },
    { titulo: "Seguros", texto: "Trabajamos con Sanitas, Adeslas y DKV; la cobertura concreta la confirma cada aseguradora" },
    { titulo: "Cancelaciones", texto: "Se puede cambiar o anular una cita hasta 24 h antes sin coste" },
  ],
  horarios: "L-V 9:30–20:00, sábados 10–14",
  enlaces: [
    { etiqueta: "Reserva online", url: "https://clinica.example/reserva" },
    { etiqueta: "Cómo llegar", url: "https://maps.example/clinica" },
  ],
}));

// La conversación: 3 entrantes reales de un lead (identificar + cita), cada
// turno evaluado con el hilo acumulado — como en producción.
const ENTRANTES = [
  "Hola, ¿cuánto cuesta más o menos una ortodoncia invisible?",
  "Vale. ¿Y qué horario tenéis? Yo solo puedo por la tarde",
  "Perfecto, me llamo Lucía y no he ido nunca. ¿Me podéis dar cita esta semana?",
];
const RESPUESTAS_CLINICA = [
  "Hola Lucía, la valoración es gratuita y ahí te concretamos tu caso.",
  "Abrimos hasta las 20:00 entre semana, por la tarde sin problema.",
];

type Usage = { inputTokens: number; outputTokens: number; cacheEscritura?: number; cacheLectura?: number };
const coste = (u: Usage): number =>
  ((u.inputTokens - 0) * PRECIO.in + u.outputTokens * PRECIO.out +
    (u.cacheEscritura ?? 0) * PRECIO.cacheWrite + (u.cacheLectura ?? 0) * PRECIO.cacheRead) / 1_000_000;

async function medirConversacion(conocimiento: EntradaEvaluador["conocimiento"], etiqueta: string) {
  const usos: Usage[] = [];
  for (let t = 0; t < ENTRANTES.length; t++) {
    const hilo: MensajeHilo[] = [];
    for (let i = 0; i <= t; i++) {
      hilo.push({ direccion: "Entrante", contenido: ENTRANTES[i], timestamp: `2026-08-22T10:0${i * 2}:00Z` });
      if (i < t) hilo.push({ direccion: "Saliente", contenido: RESPUESTAS_CLINICA[i], timestamp: `2026-08-22T10:0${i * 2 + 1}:00Z` });
    }
    const r = await evaluarTurno({
      nombre: "Lucía Martín",
      esPacienteConocido: false,
      objetivosAbiertos: OBJETIVOS_POR_DEFECTO.filter((o) => o.etapa === "identificar" || o.etapa === "cita"),
      presupuestosVivos: [],
      pendienteCobro: 0,
      hilo,
      aplazadosPendientes: [],
      aplazadosPorClave: {},
      yaDerivado: false,
      hoy: "2026-08-22",
      conocimiento,
    });
    if (!r.usage) {
      console.error(`✗ ${etiqueta} turno ${t + 1}: sin usage (¿modelo caído?) — «no pude medir».`);
      process.exit(2);
    }
    usos.push(r.usage);
  }
  return usos;
}

const eur6 = (n: number) => `$${n.toFixed(6)}`;
function reportar(etiqueta: string, usos: Usage[]) {
  const total = usos.reduce((s, u) => s + coste(u), 0);
  console.log(`\n── ${etiqueta} ──`);
  usos.forEach((u, i) => {
    console.log(
      `  turno ${i + 1}: ${eur6(coste(u))}  (in=${u.inputTokens} out=${u.outputTokens} cacheW=${u.cacheEscritura ?? 0} cacheR=${u.cacheLectura ?? 0})`,
    );
  });
  const porTurno = total / usos.length;
  console.log(`  por turno (media): ${eur6(porTurno)}`);
  console.log(`  conversación de 3 turnos: ${eur6(total)}`);
  console.log(`  al mes, 1.000 conversaciones: $${(total * 1000).toFixed(2)}`);
  return { porTurno, total };
}

console.log("Midiendo — 6 turnos reales de evaluador+juez (Haiku 4.5)…");
// El orden importa para observar el caché: la primera conversación paga la
// escritura del system; la segunda debería LEERLO (mismo prefijo, <5 min).
const generico = await medirConversacion(null, "genérico");
const completo = await medirConversacion(CONOCIMIENTO, "completo (grupo 2 cargado)");

const g = reportar("GENÉRICO (hoy)", generico);
const c = reportar("COMPLETO (tono/precios/políticas/horarios vía grupo 2)", completo);

const delta = c.total - g.total;
const cacheLeido = [...generico, ...completo].reduce((s, u) => s + (u.cacheLectura ?? 0), 0);
console.log(`\n══ Δ por conversación de 3 turnos: ${eur6(delta)} (${g.total > 0 ? ((delta / g.total) * 100).toFixed(0) : "?"} % sobre el genérico)`);
console.log(`══ caché: ${cacheLeido > 0 ? `FUNCIONA — ${cacheLeido} tokens leídos a 0.1× en esta medición` : "sin lecturas en esta pasada (prefijo recién escrito o >5 min entre llamadas)"}`);
console.log("   (el prompt de una clínica es idéntico en todas sus conversaciones: en producción, con tráfico, la lectura domina)");
