#!/usr/bin/env tsx
// QA permanente del motor de disponibilidad de la agenda (G1c, 27-08).
//
//   npx tsx scripts/qa-agenda.mts        (= npm run qa:agenda)
//
// Sin base ni servidor: el motor es puro (minutos del día local) y la única
// conversión de zona recibe la tz como parámetro — así que se afirma con
// instantes concretos, estilo qa:fechas. El motor viejo del MVP no tenía ni
// un test y arrastraba tres entradas inventadas; este nace con los casos que
// aquel ni veía: jornada partida, bloqueo de varios días, cambio de hora
// verano/invierno, y el fin exacto a medianoche.

import {
  aMin,
  deMin,
  normalizar,
  restarIntervalos,
  disponibilidadDia,
  trocearEnSlots,
  proyectarAlDia,
  franjasDelDia,
  diaSemanaISO,
  type IntervaloMin,
} from "../app/lib/agenda/disponibilidad";

let ok = 0;
const fallos: string[] = [];
const check = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) ok++;
  else fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ""}`);
};
const eq = (a: ReadonlyArray<IntervaloMin>, b: ReadonlyArray<IntervaloMin>) =>
  a.length === b.length && a.every((x, i) => x.inicio === b[i].inicio && x.fin === b[i].fin);
const pinta = (xs: ReadonlyArray<IntervaloMin>) =>
  xs.map((x) => `${deMin(x.inicio)}–${deMin(x.fin)}`).join(", ") || "∅";

// ── A · HH:MM ⇄ minutos ────────────────────────────────────────────────
check("aMin 16:30 = 990", aMin("16:30") === 990);
check("deMin 990 = 16:30", deMin(990) === "16:30");
check("aMin 00:00 = 0 y 23:59 = 1439", aMin("00:00") === 0 && aMin("23:59") === 1439);
for (const malo of ["24:00", "9:30", "16:60", "", "basura"]) {
  let lanzo = false;
  try { aMin(malo); } catch { lanzo = true; }
  check(`aMin("${malo}") LANZA (dato corrupto no es un cero)`, lanzo);
}

// ── B · normalizar ─────────────────────────────────────────────────────
check(
  "normalizar ordena y fusiona solapes y contigüos",
  eq(
    normalizar([{ inicio: 1020, fin: 1200 }, { inicio: 960, fin: 1080 }, { inicio: 1200, fin: 1260 }]),
    [{ inicio: 960, fin: 1260 }],
  ),
);
check(
  "normalizar descarta vacíos e invertidos",
  eq(normalizar([{ inicio: 600, fin: 600 }, { inicio: 700, fin: 650 }, { inicio: 100, fin: 200 }]), [{ inicio: 100, fin: 200 }]),
);

// ── C · restarIntervalos ───────────────────────────────────────────────
const F_MANANA = { inicio: aMin("10:00"), fin: aMin("14:00") };
const F_TARDE = { inicio: aMin("16:00"), fin: aMin("20:00") };

{
  const r = restarIntervalos([F_MANANA], [{ inicio: aMin("11:00"), fin: aMin("11:30") }]);
  check(
    "una cita en medio parte la franja en dos",
    eq(r, [{ inicio: aMin("10:00"), fin: aMin("11:00") }, { inicio: aMin("11:30"), fin: aMin("14:00") }]),
    pinta(r),
  );
}
{
  const r = restarIntervalos([F_MANANA, F_TARDE], [{ inicio: aMin("09:00"), fin: aMin("15:00") }]);
  check("un bloqueo que cubre la mañana entera la elimina y respeta la tarde", eq(r, [F_TARDE]), pinta(r));
}
{
  const r = restarIntervalos([F_TARDE], [{ inicio: aMin("15:30"), fin: aMin("16:45") }]);
  check(
    "ocupación que cruza el borde de la franja recorta, no rompe",
    eq(r, [{ inicio: aMin("16:45"), fin: aMin("20:00") }]),
    pinta(r),
  );
}
{
  const r = restarIntervalos([F_MANANA], [{ inicio: aMin("07:00"), fin: aMin("08:00") }]);
  check("ocupación fuera de las franjas no toca nada", eq(r, [F_MANANA]), pinta(r));
}
{
  const r = restarIntervalos(
    [F_MANANA],
    [{ inicio: aMin("10:30"), fin: aMin("11:30") }, { inicio: aMin("11:00"), fin: aMin("12:00") }],
  );
  check(
    "dos ocupaciones solapadas restan como una",
    eq(r, [{ inicio: aMin("10:00"), fin: aMin("10:30") }, { inicio: aMin("12:00"), fin: aMin("14:00") }]),
    pinta(r),
  );
}
check("sin franjas (no trabaja ese día) = sin huecos", restarIntervalos([], [{ inicio: 0, fin: 1440 }]).length === 0);

// ── D · disponibilidadDia (jornada partida) ────────────────────────────
{
  const r = disponibilidadDia({
    franjas: [{ inicio: "10:00", fin: "14:00" }, { inicio: "16:00", fin: "20:00" }],
    ocupaciones: [
      { inicio: aMin("10:30"), fin: aMin("11:00") },
      { inicio: aMin("17:00"), fin: aMin("18:00") },
    ],
  });
  check(
    "jornada partida con una cita en cada mitad",
    eq(r, [
      { inicio: aMin("10:00"), fin: aMin("10:30") },
      { inicio: aMin("11:00"), fin: aMin("14:00") },
      { inicio: aMin("16:00"), fin: aMin("17:00") },
      { inicio: aMin("18:00"), fin: aMin("20:00") },
    ]),
    pinta(r),
  );
}

// ── E · trocearEnSlots ─────────────────────────────────────────────────
{
  const r = trocearEnSlots([{ inicio: aMin("16:00"), fin: aMin("17:30") }], { duracionMin: 30 });
  check(
    "hueco de 90 min → 3 slots CONTIGUOS de 30 (no la lista solapada del motor viejo)",
    eq(r, [
      { inicio: aMin("16:00"), fin: aMin("16:30") },
      { inicio: aMin("16:30"), fin: aMin("17:00") },
      { inicio: aMin("17:00"), fin: aMin("17:30") },
    ]),
    pinta(r),
  );
}
{
  const r = trocearEnSlots([{ inicio: aMin("16:00"), fin: aMin("16:50") }], { duracionMin: 30 });
  check("el resto que no cabe se descarta (50 min → 1 slot de 30)", eq(r, [{ inicio: aMin("16:00"), fin: aMin("16:30") }]), pinta(r));
}
{
  const r = trocearEnSlots([{ inicio: aMin("10:00"), fin: aMin("11:30") }], {
    duracionMin: 30, bufferAntesMin: 10, bufferDespuesMin: 5,
  });
  check(
    "buffers: la huella (45) decide cuántos caben, el slot enseña el tratamiento",
    eq(r, [{ inicio: aMin("10:10"), fin: aMin("10:40") }, { inicio: aMin("10:55"), fin: aMin("11:25") }]),
    pinta(r),
  );
}
for (const mala of [0, -5, 2.5, NaN]) {
  let lanzo = false;
  try { trocearEnSlots([F_MANANA], { duracionMin: mala }); } catch { lanzo = true; }
  check(`duración ${mala} LANZA — sin duración configurada no se inventan 25 min`, lanzo);
}

// ── F · proyectarAlDia (la zona, estilo qa:fechas) ─────────────────────
// Madrid es UTC+1 en invierno y UTC+2 en verano. El motor viejo usaba la
// hora local del SERVIDOR (UTC en Vercel): una cita de las 09:30 aparecía a
// las 08:30. Aquí se afirma la conversión en las dos mitades del año.
{
  const r = proyectarAlDia(
    { inicio: new Date("2026-01-15T08:30:00Z"), fin: new Date("2026-01-15T09:00:00Z") },
    "2026-01-15",
  );
  check(
    "invierno: 08:30Z = 09:30 Madrid",
    r !== null && r.inicio === aMin("09:30") && r.fin === aMin("10:00"),
    r ? pinta([r]) : "null",
  );
}
{
  const r = proyectarAlDia(
    { inicio: new Date("2026-07-15T08:30:00Z"), fin: new Date("2026-07-15T09:00:00Z") },
    "2026-07-15",
  );
  check(
    "verano: 08:30Z = 10:30 Madrid",
    r !== null && r.inicio === aMin("10:30") && r.fin === aMin("11:00"),
    r ? pinta([r]) : "null",
  );
}
{
  // Cita de las 23:30 Madrid: en UTC ya es el día siguiente. El día de la
  // CLÍNICA manda (misma lección que qa:fechas).
  const r = proyectarAlDia(
    { inicio: new Date("2026-07-15T21:30:00Z"), fin: new Date("2026-07-15T22:00:00Z") },
    "2026-07-15",
  );
  check(
    "cita de las 23:30 Madrid cae en SU día aunque UTC diga el siguiente",
    r !== null && r.inicio === aMin("23:30") && r.fin === aMin("00:00") + 1440,
    r ? pinta([r]) : "null",
  );
}
{
  // Bloqueo de vacaciones: del lunes 13 a las 17:00 Madrid al jueves 16 a
  // las 09:00 Madrid. Cuatro proyecciones distintas + dos días que no toca.
  const bloqueo = { inicio: new Date("2026-07-13T15:00:00Z"), fin: new Date("2026-07-16T07:00:00Z") };
  const d13 = proyectarAlDia(bloqueo, "2026-07-13");
  const d14 = proyectarAlDia(bloqueo, "2026-07-14");
  const d16 = proyectarAlDia(bloqueo, "2026-07-16");
  check("vacaciones · día de salida: 17:00–24:00", d13 !== null && d13.inicio === aMin("17:00") && d13.fin === 1440, d13 ? pinta([d13]) : "null");
  check("vacaciones · día interior: 00:00–24:00 entero", d14 !== null && d14.inicio === 0 && d14.fin === 1440, d14 ? pinta([d14]) : "null");
  check("vacaciones · día de vuelta: 00:00–09:00", d16 !== null && d16.inicio === 0 && d16.fin === aMin("09:00"), d16 ? pinta([d16]) : "null");
  check("vacaciones · el día antes no lo pisa", proyectarAlDia(bloqueo, "2026-07-12") === null);
  check("vacaciones · el día después tampoco", proyectarAlDia(bloqueo, "2026-07-17") === null);
}
{
  // Fin EXACTO a medianoche: un bloqueo que termina a las 00:00 del día 16
  // NO pisa el día 16.
  const b = { inicio: new Date("2026-07-15T10:00:00Z"), fin: new Date("2026-07-15T22:00:00Z") }; // fin = 16-jul 00:00 Madrid
  check("fin exacto a las 00:00 no pisa el día siguiente", proyectarAlDia(b, "2026-07-16") === null);
  const d15 = proyectarAlDia(b, "2026-07-15");
  check("…y en su día llega hasta las 24:00", d15 !== null && d15.fin === 1440, d15 ? pinta([d15]) : "null");
}
check("intervalo invertido → null, no basura", proyectarAlDia({ inicio: new Date("2026-07-15T10:00:00Z"), fin: new Date("2026-07-15T09:00:00Z") }, "2026-07-15") === null);

// ── G · calendario ─────────────────────────────────────────────────────
check("2026-08-24 es lunes (1)", diaSemanaISO("2026-08-24") === 1);
check("2026-08-30 es domingo (7)", diaSemanaISO("2026-08-30") === 7);
{
  const filas = [
    { dia_semana: 1, inicio: "10:00", fin: "14:00" },
    { dia_semana: 1, inicio: "16:00", fin: "20:00" },
    { dia_semana: 3, inicio: "09:00", fin: "13:00" },
  ];
  check("franjasDelDia: el lunes devuelve SUS dos franjas (jornada partida)", franjasDelDia(filas, "2026-08-24").length === 2);
  check("franjasDelDia: el martes sin filas = no trabaja", franjasDelDia(filas, "2026-08-25").length === 0);
}

// ── H · la historia completa de un doctor y su día ─────────────────────
// Lunes: 10–14 y 16–20 · bloqueo 17–18 · citas 10:30–11:00 y 16:00–16:30 ·
// tratamiento de 30 min. A mano: libres 10–10:30, 11–14, 16:30–17, 18–20 →
// 1 + 6 + 1 + 4 = 12 slots.
{
  const libres = disponibilidadDia({
    franjas: franjasDelDia(
      [{ dia_semana: 1, inicio: "10:00", fin: "14:00" }, { dia_semana: 1, inicio: "16:00", fin: "20:00" }],
      "2026-08-24",
    ),
    ocupaciones: [
      { inicio: aMin("17:00"), fin: aMin("18:00") }, // bloqueo
      { inicio: aMin("10:30"), fin: aMin("11:00") }, // cita
      { inicio: aMin("16:00"), fin: aMin("16:30") }, // cita
    ],
  });
  const slots = trocearEnSlots(libres, { duracionMin: 30 });
  check("historia completa: 12 slots de 30 min", slots.length === 12, `${slots.length} → ${pinta(slots)}`);
  check(
    "…y el primero de la tarde es 16:30 (la cita de las 16:00 lo empuja)",
    slots.some((s) => s.inicio === aMin("16:30")) && !slots.some((s) => s.inicio === aMin("16:00")),
  );
}

// ── I · instanteDeCita (G2c: la cita real del lead) ────────────────────
// fecha+hora locales de clínica → instante UTC. Verano e invierno, y la
// entrada ilegible devuelve null (el caller decide el error).
{
  const { instanteDeCita } = await import("../app/lib/agenda/cita-de-lead");
  const v = instanteDeCita("2026-08-31", "9:30");
  check("verano: 09:30 Madrid = 07:30Z", v !== null && v.toISOString() === "2026-08-31T07:30:00.000Z", v?.toISOString() ?? "null");
  const i = instanteDeCita("2026-01-15", "16:00");
  check("invierno: 16:00 Madrid = 15:00Z", i !== null && i.toISOString() === "2026-01-15T15:00:00.000Z", i?.toISOString() ?? "null");
  for (const [f, h] of [["2026-8-1", "10:00"], ["2026-08-01", "25:00"], ["2026-08-01", "basura"]] as const) {
    check(`instanteDeCita("${f}", "${h}") → null`, instanteDeCita(f, h) === null);
  }
}

// ── J · resumen plegado de la Lista (G2.2, revisado en G2.5) ───────────
// Dictado 30-08: lo esencial — citas y horas libres, las horas CONCRETAS al
// desplegar; el resumen devuelve PARTES con énfasis para la jerarquía visual.
{
  const { resumenDeAgendaDia, formatoDuracion } = await import("../app/lib/agenda/resumen");
  check("formatoDuracion 120 = «2 h»", formatoDuracion(120) === "2 h");
  check("formatoDuracion 90 = «1 h 30 min»", formatoDuracion(90) === "1 h 30 min");
  check("formatoDuracion 45 = «45 min»", formatoDuracion(45) === "45 min");
  {
    const r = resumenDeAgendaDia({ trabaja: false, nCitas: 0, libres: [] });
    check("resumen: no trabaja → solo la nota", r.nota === "no trabaja" && r.libres === null);
  }
  {
    const r = resumenDeAgendaDia({ trabaja: false, nCitas: 2, libres: [] });
    check(
      "resumen: citas fuera de su horario se DICEN, no se esconden",
      r.nota === null && r.citas === "2 citas" && r.fueraDeHorario === true,
    );
  }
  {
    const r = resumenDeAgendaDia({ trabaja: true, nCitas: 3, libres: [] });
    check("resumen: sin horas libres, APAGADO", r.libres?.texto === "sin horas libres" && r.libres.enfasis === "apagado");
  }
  {
    const r = resumenDeAgendaDia({
      trabaja: true, nCitas: 2,
      libres: [{ inicio: aMin("16:00"), fin: aMin("17:30") }, { inicio: aMin("18:30"), fin: aMin("19:00") }],
    });
    check(
      "resumen: el total libre DESTACA y sin horas concretas (van al desplegar)",
      r.citas === "2 citas" && r.libres?.texto === "2 h libres" && r.libres.enfasis === "destacado",
    );
  }
  {
    const r = resumenDeAgendaDia({ trabaja: true, nCitas: 1, libres: null });
    check("resumen: cita sin duración → AVISO no afirmable", r.libres?.texto === "huecos no afirmables" && r.libres.enfasis === "aviso");
  }
}

// ── resultado ──────────────────────────────────────────────────────────
if (fallos.length > 0) {
  console.error(`✗ ${fallos.length} fallos:`);
  for (const f of fallos) console.error("   ·", f);
  process.exit(1);
}
console.log(`✓ ${ok} comprobaciones del motor de disponibilidad, todas verdes.`);
