#!/usr/bin/env tsx
// QA permanente del NIVEL 2 — el mapeo evento-de-Calendar → ocupación.
//
//   npx tsx scripts/qa-agenda-externa.mts   (= npm run qa:agenda-externa)
//
// Sin red ni credencial: mapearEvento es puro y aquí se afirma con FIXTURES
// con la forma real de la API de Google. Los casos son exactamente los raros
// que el diagnóstico predijo que morderían: cancelado, «disponible»
// (transparent), día entero en INVIERNO (el offset fijo +02 era el bug),
// recurrente ya expandido, y evento sin fin. También la edad legible del
// dato, que es copy de producto.

import { mapearEvento, type EventoGoogle } from "../app/lib/conectores/google-calendar";
import { edadLegible } from "../app/lib/agenda/fechas";

let fallos = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fallos++;
}

// ── 1 · Evento normal con dateTime (con su offset) ──────────────────────────
{
  const r = mapearEvento({
    id: "ev1",
    summary: "Revisión Sra. García",
    start: { dateTime: "2026-09-02T10:00:00+02:00" },
    end: { dateTime: "2026-09-02T10:45:00+02:00" },
  });
  ok(r != null && "ocupacion" in r, "evento normal → ocupación");
  if (r && "ocupacion" in r) {
    ok(r.ocupacion.inicio.toISOString() === "2026-09-02T08:00:00.000Z", "el offset del ISO se respeta (10:00+02 = 08:00Z)");
    ok(r.ocupacion.etiqueta === "Revisión Sra. García", "la etiqueta es el título, texto plano");
    ok(r.ocupacion.pacienteTexto === null && r.ocupacion.tratamientoTexto === null, "paciente/tratamiento NO se adivinan del título");
  }
}

// ── 2 · Cancelado → borrado (sync incremental con showDeleted) ──────────────
{
  const r = mapearEvento({ id: "ev2", status: "cancelled" });
  ok(r != null && "borrado" in r && r.borrado === "ev2", "cancelado → borrado");
}

// ── 3 · «Disponible» (transparency) NO ocupa → borrado ──────────────────────
{
  const r = mapearEvento({
    id: "ev3",
    summary: "Hueco publicado",
    transparency: "transparent",
    start: { dateTime: "2026-09-02T10:00:00+02:00" },
    end: { dateTime: "2026-09-02T11:00:00+02:00" },
  });
  ok(r != null && "borrado" in r, "transparent → NO ocupa (llega como borrado para purgar)");
}

// ── 4 · Día entero en INVIERNO: la medianoche es la de Madrid ───────────────
// El bug que este caso caza: un offset fijo +02:00 pondría el bloqueo del 15
// de enero empezando a las 23:00 del día 14 (Madrid es +01 en enero).
{
  const r = mapearEvento({
    id: "ev4",
    summary: "Congreso",
    start: { date: "2026-01-15" },
    end: { date: "2026-01-16" },
  });
  ok(r != null && "ocupacion" in r, "día entero → ocupación");
  if (r && "ocupacion" in r) {
    ok(r.ocupacion.diaEntero, "marcado diaEntero");
    ok(r.ocupacion.inicio.toISOString() === "2026-01-14T23:00:00.000Z", `medianoche de Madrid en enero = 23:00Z del día anterior (${r.ocupacion.inicio.toISOString()})`);
    ok(r.ocupacion.fin.toISOString() === "2026-01-15T23:00:00.000Z", "end exclusivo: ocupa exactamente el día 15 local");
  }
}

// ── 5 · Día entero en VERANO: +02 ───────────────────────────────────────────
{
  const r = mapearEvento({ id: "ev5", start: { date: "2026-08-15" }, end: { date: "2026-08-16" } });
  ok(r != null && "ocupacion" in r && r.ocupacion.inicio.toISOString() === "2026-08-14T22:00:00.000Z",
    "medianoche de Madrid en agosto = 22:00Z del día anterior");
}

// ── 6 · Sin cuándo, o fin ≤ inicio → no es ocupación ────────────────────────
{
  ok(mapearEvento({ id: "ev6", summary: "sin fechas" }) === null, "evento sin start/end → null");
  ok(
    mapearEvento({
      id: "ev7",
      start: { dateTime: "2026-09-02T11:00:00+02:00" },
      end: { dateTime: "2026-09-02T10:00:00+02:00" },
    }) === null,
    "fin antes del inicio → null",
  );
}

// ── 7 · Sin título → etiqueta null (privado no se inventa) ──────────────────
{
  const r = mapearEvento({
    id: "ev8",
    start: { dateTime: "2026-09-02T10:00:00+02:00" },
    end: { dateTime: "2026-09-02T10:30:00+02:00" },
  });
  ok(r != null && "ocupacion" in r && r.ocupacion.etiqueta === null, "sin summary → etiqueta null");
}

// ── 8 · La EDAD legible (copy de producto) ──────────────────────────────────
{
  const ahora = new Date("2026-08-31T12:00:00Z");
  ok(edadLegible(new Date(ahora.getTime() - 30_000).toISOString(), ahora) === "hace menos de un minuto", "edad <1 min");
  ok(edadLegible(new Date(ahora.getTime() - 3 * 60_000).toISOString(), ahora) === "hace 3 min", "edad en minutos");
  ok(edadLegible(new Date(ahora.getTime() - 2 * 3_600_000).toISOString(), ahora) === "hace 2 h", "edad en horas");
  ok(edadLegible(new Date(ahora.getTime() - 30 * 3_600_000).toISOString(), ahora).startsWith("el "), "más de un día → fecha con hora");
}

console.log(fallos === 0 ? "\n✓ QA agenda externa: todo verde." : `\n✗ ${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
