#!/usr/bin/env tsx
// QA permanente del día de la clínica (MEJORAS 52).
//
//   npx tsx scripts/qa-fechas-tz.mts        (= npm run qa:fechas)
//
// No necesita base de datos ni servidor: son funciones puras evaluadas en
// instantes concretos. Eso es lo que lo hace un test de verdad — el bug vive en
// una ventana de dos horas al día, así que "probarlo a mano" es tirar una
// moneda.
//
// Lo que se afirma:
//   1. El día y el mes de la clínica NO dependen de la zona del proceso. Se
//      ejecuta con TZ=UTC (Vercel), TZ=Europe/Madrid y TZ=America/New_York
//      (la máquina desde la que se hacen las demos) y los tres dan lo mismo.
//   2. `toISOString().slice(0,10)` SÍ falla, y falla justo donde se dijo: entre
//      las 00:00 y las 02:00 de Madrid (01:00 en invierno) devuelve el día
//      anterior. El test lo demuestra en vez de creérselo.
//   3. Un lead citado HOY sigue en su cohorte "citados" a cualquier hora del
//      día — que es la consecuencia de negocio: si el día se desplaza, el caso
//      desaparece de la columna "Citados Hoy" y de su cohorte de Seguimiento.

import { hoyISO, mesISO, horaClinica, inicioDelDiaUTC, sumaDias, TZ_CLINICA } from "../app/lib/time";
import { cohorteLead, esNuevoUrgente } from "../app/lib/seguimiento/cohortes";
import {
  estadoConversacion,
  diasDeClinicaEntre,
  UMBRAL_REACTIVACION_DIAS,
} from "../app/lib/presupuestos/estado-conversacion";

let ok = 0;
const fallos: string[] = [];
const check = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) ok++;
  else fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

// Instantes de prueba, en UTC. Madrid es UTC+2 en verano y UTC+1 en invierno.
const INSTANTES: Array<{ utc: string; diaClinica: string; horaClinica: string; nota: string }> = [
  { utc: "2026-07-27T09:00:00Z", diaClinica: "2026-07-27", horaClinica: "11:00", nota: "media mañana" },
  { utc: "2026-07-27T19:59:00Z", diaClinica: "2026-07-27", horaClinica: "21:59", nota: "21:59 Madrid" },
  { utc: "2026-07-27T20:01:00Z", diaClinica: "2026-07-27", horaClinica: "22:01", nota: "22:01 Madrid" },
  { utc: "2026-07-27T22:30:00Z", diaClinica: "2026-07-28", horaClinica: "00:30", nota: "00:30 · UTC dice ayer" },
  { utc: "2026-07-27T23:45:00Z", diaClinica: "2026-07-28", horaClinica: "01:45", nota: "01:45 · UTC dice ayer" },
  { utc: "2026-01-15T23:30:00Z", diaClinica: "2026-01-16", horaClinica: "00:30", nota: "invierno 00:30" },
  { utc: "2026-07-31T22:30:00Z", diaClinica: "2026-08-01", horaClinica: "00:30", nota: "cambio de MES" },
  { utc: "2026-12-31T23:30:00Z", diaClinica: "2027-01-01", horaClinica: "00:30", nota: "cambio de AÑO" },
];

console.log(`Zona de la clínica: ${TZ_CLINICA} · zona del proceso: ${process.env.TZ ?? "(la del sistema)"}\n`);

// ── 1 · el día y la hora de la clínica son correctos ───────────────────
for (const c of INSTANTES) {
  const d = new Date(c.utc);
  check(`día de ${c.utc} (${c.nota})`, hoyISO(d) === c.diaClinica, `dio ${hoyISO(d)}, esperado ${c.diaClinica}`);
  check(`hora de ${c.utc}`, horaClinica(d) === c.horaClinica, `dio ${horaClinica(d)}, esperado ${c.horaClinica}`);
  check(`mes de ${c.utc}`, mesISO(d) === c.diaClinica.slice(0, 7));
}

// ── 2 · la fórmula vieja falla, y falla donde se dijo ──────────────────
const ventana = INSTANTES.filter((c) => new Date(c.utc).toISOString().slice(0, 10) !== c.diaClinica);
check(
  "la fórmula vieja (toISOString) se equivoca en la madrugada",
  ventana.length >= 4,
  `solo falló en ${ventana.length} instantes`,
);
console.log("Instantes donde `toISOString().slice(0,10)` da el día equivocado:");
for (const c of ventana) {
  console.log(`   ${c.utc}  clínica=${c.diaClinica} ${c.horaClinica}  →  UTC decía ${new Date(c.utc).toISOString().slice(0, 10)}`);
}
console.log();

// ── 3 · la consecuencia de negocio ─────────────────────────────────────
// Un lead con cita HOY, a lo largo de las 24 horas del día: su cohorte no
// puede cambiar por la hora a la que se mire el tablero.
const diaDePrueba = "2026-07-28";
let horasMal = 0;
for (let h = 0; h < 24; h++) {
  // 00:00 de Madrid del día de prueba + h horas.
  const instante = new Date(inicioDelDiaUTC(diaDePrueba).getTime() + h * 3_600_000);
  const hoy = hoyISO(instante);
  const cohorte = cohorteLead({ fechaCita: diaDePrueba, hoy, conversacion: "sin_conversacion" });
  const enCitadosHoy = diaDePrueba === hoy; // la regla de `columnOf` del kanban
  if (cohorte !== "citados" || !enCitadosHoy) horasMal++;
}
check(
  "un lead citado hoy sigue en 'citados' y en la columna a las 24 horas del día",
  horasMal === 0,
  `falló en ${horasMal} de 24 horas`,
);

// La misma prueba con la fórmula vieja, para que quede el contraste medido.
let horasMalViejo = 0;
for (let h = 0; h < 24; h++) {
  const instante = new Date(inicioDelDiaUTC(diaDePrueba).getTime() + h * 3_600_000);
  const hoyViejo = instante.toISOString().slice(0, 10);
  if (diaDePrueba !== hoyViejo) horasMalViejo++;
}
console.log(`Con la fórmula vieja, ese mismo lead se caía de la columna ${horasMalViejo} de las 24 horas.\n`);

// ── 4 · aritmética de calendario ───────────────────────────────────────
check("sumaDias cruza el cambio de mes", sumaDias("2026-07-31", 1) === "2026-08-01");
check("sumaDias cruza el cambio de año hacia atrás", sumaDias("2027-01-01", -1) === "2026-12-31");
check("sumaDias respeta los bisiestos", sumaDias("2028-02-28", 1) === "2028-02-29");
check("inicio del día en verano son las 22:00 UTC del día anterior",
  inicioDelDiaUTC("2026-07-28").toISOString() === "2026-07-27T22:00:00.000Z");
check("inicio del día en invierno son las 23:00 UTC del día anterior",
  inicioDelDiaUTC("2026-01-15").toISOString() === "2026-01-14T23:00:00.000Z");

// ── 5 · el umbral de reactivación no se mueve dentro del mismo día ─────
//
// El bug (2026-07-31): `reactivable` era "hace ≥72 h EXACTAS" contra
// `Date.now()`, o sea una ventana rodante que se cruza al segundo. Medido en
// /red, el titular «cuánto hay en juego hoy» subía 1.750 € en dos minutos y un
// 62 % en 24 h sin que nadie tocara nada, y dos F5 seguidos daban dos cifras
// distintas. Anclado al día de la clínica, la clasificación de un caso solo
// puede cambiar a las 00:00 — nunca en mitad de una demo.
{
  const escrito = "2026-07-25T14:30:00Z"; // saliente nuestro, sin respuesta
  const entrada = { ultimoEntranteAt: null, ultimoSalienteAt: escrito };

  // A lo largo de un día completo de la clínica, el estado es CONSTANTE.
  for (const dia of ["2026-07-27", "2026-07-28"]) {
    const estados = new Set<string>();
    for (let m = 0; m < 24 * 60; m += 7) {
      const instante = new Date(inicioDelDiaUTC(dia).getTime() + m * 60_000);
      estados.add(
        estadoConversacion(entrada, UMBRAL_REACTIVACION_DIAS.presupuesto, instante).estado,
      );
    }
    check(
      `el estado de un presupuesto no cambia durante el día ${dia}`,
      estados.size === 1,
      `cambió entre ${[...estados].join(" y ")}`,
    );
  }

  // Y sí cambia justo en el cambio de día: el 27 son 2 días (en espera), el 28
  // son 3 (reactivable). El umbral hace su trabajo, solo que a medianoche.
  const el27 = estadoConversacion(
    entrada, UMBRAL_REACTIVACION_DIAS.presupuesto,
    new Date(inicioDelDiaUTC("2026-07-27").getTime() + 12 * 3_600_000),
  ).estado;
  const el28 = estadoConversacion(
    entrada, UMBRAL_REACTIVACION_DIAS.presupuesto,
    new Date(inicioDelDiaUTC("2026-07-28").getTime() + 12 * 3_600_000),
  ).estado;
  check("a los 2 días sigue en espera", el27 === "en_espera_paciente", `dio ${el27}`);
  check("a los 3 días pasa a reactivable", el28 === "reactivable", `dio ${el28}`);

  // La fórmula vieja SÍ se movía dentro del día: se demuestra, no se supone.
  const UMBRAL_VIEJO_MS = 72 * 3_600_000;
  const escritoMs = new Date(escrito).getTime();
  const estadoViejo = (instante: Date) =>
    instante.getTime() - escritoMs < UMBRAL_VIEJO_MS ? "en_espera_paciente" : "reactivable";
  const viejos = new Set<string>();
  for (let m = 0; m < 24 * 60; m += 7) {
    viejos.add(estadoViejo(new Date(inicioDelDiaUTC("2026-07-28").getTime() + m * 60_000)));
  }
  check(
    "la fórmula vieja SÍ cambiaba de estado a media tarde",
    viejos.size === 2,
    `no reprodujo el bug (dio ${[...viejos].join(", ")})`,
  );

  // Y el día se cuenta en la zona de la CLÍNICA, no en la del proceso: un
  // saliente a las 00:30 de Madrid es de hoy, aunque en UTC sea de ayer.
  const medianoche = { ultimoEntranteAt: null, ultimoSalienteAt: "2026-07-27T22:30:00Z" };
  check(
    "un saliente de las 00:30 de Madrid cuenta como de HOY, no de ayer",
    diasDeClinicaEntre(
      new Date(medianoche.ultimoSalienteAt),
      new Date(inicioDelDiaUTC("2026-07-28").getTime() + 10 * 3_600_000),
    ) === 0,
  );

  // Un lead sin contactar usa el MISMO reloj de días (era `NUEVO_URGENTE_MS`,
  // que al pasar el umbral a días habría significado "2 milisegundos").
  const alta = "2026-07-26T09:00:00Z";
  check(
    "un lead de hace 1 día todavía no es urgente",
    !esNuevoUrgente(alta, new Date(inicioDelDiaUTC("2026-07-27").getTime() + 12 * 3_600_000)),
  );
  check(
    "un lead de hace 2 días ya es urgente",
    esNuevoUrgente(alta, new Date(inicioDelDiaUTC("2026-07-28").getTime() + 12 * 3_600_000)),
  );
}

// ── resultado ──────────────────────────────────────────────────────────
if (fallos.length > 0) {
  console.error(`✗ ${fallos.length} fallos:`);
  for (const f of fallos) console.error("   ·", f);
  process.exit(1);
}
console.log(`✓ ${ok} comprobaciones, todas verdes.`);
