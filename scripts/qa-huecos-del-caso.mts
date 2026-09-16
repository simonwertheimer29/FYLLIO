#!/usr/bin/env tsx
// QA DEL PASO 3 DE LA FICHA, SIN BASE Y SIN MODELO ($0): las piezas PURAS.
//
//   npm run qa:huecos
//
// Lo que se prueba y por qué:
//  · elegirHuecos — la escalera de ampliación (días en SU orden → suelta la
//    franja → suelta los días → todo) y que sin preferencia no «amplía».
//  · casarTratamiento — «una limpieza» casa con «Limpieza dental»; dos
//    candidatos = ninguno (se pide elegir); texto vacío = ninguno.
//  · garantiaDe — los tres valores de frescura y lo que cada uno permite:
//    en_vivo reserva; copia no, y lleva la lectura MÁS ANTIGUA; rota sin
//    fecha; sin_agenda no.
//  · textoConfirmacionCita — dice día, hora, doctor y clínica; no dice
//    tratamiento; deja la puerta del «no me viene bien».
// Salida: 0 = todo verde · 1 = algún rojo (se listan).

import { elegirHuecos, casarTratamiento } from "../app/lib/agenda/huecos-del-caso";
import { garantiaDe } from "../app/lib/agenda/garantia";
import { textoConfirmacionCita } from "../app/lib/agenda/confirmacion-cita";

let rojos = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) rojos++;
};

// Semana del lunes 21-09-2026 al domingo 4-10.
const slot = (fecha: string, hhmm: string, doctorId = "d1") => {
  const [h, m] = hhmm.split(":").map(Number);
  return { fecha, slot: { inicio: h! * 60 + m!, fin: h! * 60 + m! + 30 }, doctorId };
};
const S = [
  slot("2026-09-21", "10:00"), // lunes mañana
  slot("2026-09-22", "17:00"), // martes tarde
  slot("2026-09-24", "16:00"), // jueves tarde
  slot("2026-09-25", "09:30"), // viernes mañana
  slot("2026-10-01", "11:00"), // jueves mañana (segunda semana)
];

console.log("══ elegirHuecos");
{
  const r = elegirHuecos(S, { franja: "manana", dias: ["jue", "vie"], urgencia: null });
  ok(r.ampliado === null && r.elegidos.map((e) => e.fecha).join(",") === "2026-10-01,2026-09-25", "jueves antes que viernes aunque el viernes sea antes en el calendario (orden de preferencia)");
}
{
  const r = elegirHuecos(S, { franja: "manana", dias: ["mar"], urgencia: null });
  ok(r.ampliado === "franja" && r.elegidos[0]?.fecha === "2026-09-22", "sin martes por la mañana → amplía la FRANJA y da el martes por la tarde");
}
{
  const r = elegirHuecos(S, { franja: "tarde", dias: ["mie"], urgencia: null });
  ok(r.ampliado === "dias" && r.elegidos[0]?.fecha === "2026-09-22", "sin miércoles → amplía los DÍAS y da la primera tarde (martes)");
}
{
  const r = elegirHuecos(S, { franja: "manana", dias: ["dom"], urgencia: null });
  ok(r.ampliado === "dias" && r.elegidos[0]?.fecha === "2026-09-21", "sin domingos pero con mañanas → amplía los DÍAS antes que soltarlo todo");
}
{
  const soloTardes = S.filter((x) => x.slot.inicio >= 14 * 60);
  const r = elegirHuecos(soloTardes, { franja: "manana", dias: ["dom"], urgencia: null });
  ok(r.ampliado === "todo" && r.elegidos[0]?.fecha === "2026-09-22", "sin domingos NI mañanas → todo: el primero del calendario");
}
{
  const r = elegirHuecos(S, null);
  ok(r.ampliado === null && r.elegidos.length === 3 && r.elegidos[0]?.fecha === "2026-09-21", "sin preferencia: los tres primeros, sin ampliar");
}
{
  const r = elegirHuecos(S, { franja: "indiferente", dias: [], urgencia: "cuanto_antes" });
  ok(r.ampliado === null && r.elegidos.length === 3, "indiferente + sin días = sin preferencia");
}
{
  const r = elegirHuecos([], { franja: "manana", dias: ["jue"], urgencia: null });
  ok(r.elegidos.length === 0 && r.ampliado === null, "sin slots → vacío, sin fingir ampliación");
}

console.log("══ casarTratamiento");
const CAT = [
  { id: "t1", nombre: "Limpieza dental", duracionMin: 30 },
  { id: "t2", nombre: "Revisión", duracionMin: 20 },
  { id: "t3", nombre: "Ortodoncia · revisión", duracionMin: 20 },
  { id: "t4", nombre: "Blanqueamiento", duracionMin: 60 },
];
ok(casarTratamiento("una limpieza", CAT)?.id === "t1", "«una limpieza» → Limpieza dental");
ok(casarTratamiento("Limpieza", CAT)?.id === "t1", "«Limpieza» (mayúscula) → Limpieza dental");
ok(casarTratamiento("revisión", CAT) === null, "«revisión» casa con dos → ninguno (se pide elegir)");
ok(casarTratamiento("me duele una muela", CAT) === null, "«me duele una muela» → ninguno");
ok(casarTratamiento(null, CAT) === null && casarTratamiento("", CAT) === null, "sin texto → ninguno");

console.log("══ garantiaDe");
{
  const g = garantiaDe({ agendaEnFyllio: true, externas: [] });
  ok(g.frescura === "en_vivo" && g.puedeReservar && g.desdeISO === null, "en Fyllio → en_vivo, reserva");
}
{
  const vieja = new Date("2026-09-17T08:00:00Z");
  const nueva = new Date("2026-09-17T09:30:00Z");
  const g = garantiaDe({ agendaEnFyllio: false, externas: [
    { staffId: "A", fuente: "google_calendar", ultimoSyncOk: nueva, ultimoError: null },
    { staffId: "B", fuente: "google_calendar", ultimoSyncOk: vieja, ultimoError: null },
  ] });
  ok(g.frescura === "copia" && !g.puedeReservar && g.desdeISO === vieja.toISOString(), "copia: no reserva y la fecha es la lectura MÁS ANTIGUA");
  ok(g.texto.includes("Copia de la agenda"), "copia: el texto dice que es una copia y de cuándo");
}
{
  const g = garantiaDe({ agendaEnFyllio: false, externas: [{ staffId: "A", fuente: "google_calendar", ultimoSyncOk: null, ultimoError: "401" }] });
  ok(g.frescura === "copia" && g.desdeISO === null && g.fuentesRotas.length === 1 && g.texto.includes("rota"), "copia con la única lectura rota: sin fecha, y lo dice");
}
{
  const g = garantiaDe({ agendaEnFyllio: false, externas: [] });
  ok(g.frescura === "sin_agenda" && !g.puedeReservar && g.texto.includes("no son reales"), "sin nada → sin_agenda, el aviso de siempre");
}
{
  const g = garantiaDe({ agendaEnFyllio: true, externas: [{ staffId: "A", fuente: "google_calendar", ultimoSyncOk: null, ultimoError: "x" }] });
  ok(g.frescura === "en_vivo", "en Fyllio manda sobre una externa (la externa es ocupación extra, no la fuente)");
}

console.log("══ textoConfirmacionCita");
{
  const t = textoConfirmacionCita({ nombre: "Lucía Pérez", fecha: "2026-09-24", hora: "10:00", doctor: "Dra. Marta Villalba", clinica: "Clínica Norte" });
  ok(t.startsWith("Hola, Lucía."), "saluda por el primer nombre");
  ok(t.includes("jueves") && t.includes("24 de septiembre") && t.includes("10:00"), "dice día de la semana, fecha y hora");
  ok(t.includes("Dra. Marta Villalba") && t.includes("Clínica Norte"), "dice doctor y clínica");
  ok(t.includes("Si no te viene bien"), "deja la puerta del «no me viene bien»");
  ok(!/limpieza|implante|ortodoncia|€/i.test(t), "no dice tratamiento ni precio");
}
{
  const t = textoConfirmacionCita({ nombre: "Ana", fecha: "2026-09-24", hora: "10:00", doctor: null, clinica: null });
  ok(!t.includes(" con ") && !t.includes(" en "), "sin doctor ni clínica: no inventa ni deja huecos vacíos");
}

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ todo verde");
process.exit(rojos ? 1 : 0);
