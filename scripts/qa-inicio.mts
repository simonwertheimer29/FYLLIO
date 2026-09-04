#!/usr/bin/env tsx
// QA de Inicio (31-08): el reloj de «desde ayer» con fechas fijas (sin base) y
// la capa de datos contra DEMO (invariantes, no cifras).
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  if (l.includes("=") && !l.startsWith("#")) { const i = l.indexOf("="); process.env[l.slice(0, i)] ??= l.slice(i + 1).trim(); }
}
import { ultimoCierreDeJornada } from "../app/lib/seguimiento/tiempo-laborable";
let fallos = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fallos++; };
const madrid = (iso: string) => new Date(iso); // ISO con offset explícito
const fmt = (d: Date) => d.toISOString();

// ── El reloj: horario default L–V 9–20 ──
// Martes 1 sept 2026 11:00 Madrid (+02) → lunes 31 ago 20:00 Madrid = 18:00Z
ok(fmt(ultimoCierreDeJornada(madrid("2026-09-01T11:00:00+02:00"))) === "2026-08-31T18:00:00.000Z", "martes 11:00 → cierre del lunes a las 20:00");
// Lunes 31 ago 09:00 → VIERNES 28 ago 20:00 (el fin de semana entero)
ok(fmt(ultimoCierreDeJornada(madrid("2026-08-31T09:00:00+02:00"))) === "2026-08-28T18:00:00.000Z", "lunes 9:00 → cierre del VIERNES: el fin de semana entra");
// Lunes 31 ago 21:00 (ya cerrado hoy) → hoy 20:00
ok(fmt(ultimoCierreDeJornada(madrid("2026-08-31T21:00:00+02:00"))) === "2026-08-31T18:00:00.000Z", "lunes 21:00 → el cierre de HOY (lo que pasó desde que cerró)");
// Sábado 5 sept 12:00 → viernes 4 sept 20:00
ok(fmt(ultimoCierreDeJornada(madrid("2026-09-05T12:00:00+02:00"))) === "2026-09-04T18:00:00.000Z", "sábado → cierre del viernes");
// Invierno: martes 13 ene 2026 11:00 (+01) → lunes 12 ene 20:00 = 19:00Z
ok(fmt(ultimoCierreDeJornada(madrid("2026-01-13T11:00:00+01:00"))) === "2026-01-12T19:00:00.000Z", "en invierno el cierre es 19:00Z (zona de la clínica, no offset fijo)");
// No depende de quién mira: dos llamadas, mismo instante → misma ventana.
ok(fmt(ultimoCierreDeJornada(madrid("2026-09-01T11:00:00+02:00"))) === fmt(ultimoCierreDeJornada(madrid("2026-09-01T11:00:00+02:00"))), "determinista: la ventana es de la clínica, no del usuario");

// ── La capa de datos contra DEMO: invariantes ──
const { runWithCliente } = await import("../app/lib/cliente-contexto");
const { calcularInicio, VENTANA_COCINADO_DIAS } = await import("../app/lib/inicio/calcular");
const t0 = Date.now();
const red = await runWithCliente("DEMO" as any, () => calcularInicio({ clinicaIds: null, esRed: true }));
const ms = Date.now() - t0;
console.log(`  calcularInicio(red): ${ms} ms`);
ok(red.esRed && red.clinicas != null && red.clinicas.length >= 2, "red: trae la tabla de clínicas");
ok(red.fyllioMes.ventanaCocinadoDias === VENTANA_COCINADO_DIAS && VENTANA_COCINADO_DIAS === 30, "la ventana de «cocinado» (30 días) viaja en el payload: es política, se dice");
for (const p of red.fyllioMes.procesos) {
  ok(p.cocinado == null || p.cocinado <= p.resultado, `${p.proceso}: cocinado (${p.cocinado}) ≤ resultado (${p.resultado})`);
}
ok(red.fyllioMes.procesos.some((p) => (p.cocinado ?? 0) > 0), "algún proceso llegó cocinado (el log sembrado desde los hilos lo produce)");
ok(red.fyllioMes.detalle.costeDesdeISO != null && (red.fyllioMes.detalle.costeUsd ?? 0) > 0, `coste medido con «desde» (${red.fyllioMes.detalle.costeDesdeISO?.slice(0, 10)}, ${red.fyllioMes.detalle.costeUsd} USD)`);
ok(red.desdeAyer.desdeISO < red.generadoEnISO, "«desde ayer» empieza antes de ahora");
ok(Object.values(red.equipo.porCohorte).reduce((a, b) => a + b, 0) === red.equipo.total, "las cohortes suman el total del equipo");
ok(red.dineroParado.lineas.length >= 3, `dinero parado: ${red.dineroParado.lineas.length} líneas de riesgo`);
// Una clínica sola: sin bloque 3 y scoping.
const c0 = red.clinicas![0].id;
const una = await runWithCliente("DEMO" as any, () => calcularInicio({ clinicaIds: [c0], esRed: false }));
ok(!una.esRed && una.clinicas === null, "clínica única: sin bloque 3");
ok(una.equipo.total <= red.equipo.total, "clínica única: el equipo es un subconjunto de la red");

console.log(fallos === 0 ? "\n✓ QA inicio: todo verde." : `\n✗ ${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
