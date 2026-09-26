#!/usr/bin/env tsx
// QA DEL PASO 3 DE LA FICHA, SIN BASE Y SIN MODELO ($0): las piezas PURAS.
//
//   npm run qa:huecos
//
// Lo que se prueba y por qué:
//  · huecosPorBloques y sugerirPropuesta — los dos bloques del selector y la
//    propuesta ya hecha (la única regla de sugerencia: selector, repuesto y
//    agente), con prisa, hora pedida y la tarde desde las 15:00.
//  · casarTratamiento — «una limpieza» casa con «Limpieza dental»; dos
//    candidatos = ninguno (se pide elegir); texto vacío = ninguno.
//  · garantiaDe — los tres valores de frescura y lo que cada uno permite:
//    en_vivo reserva; copia no, y lleva la lectura MÁS ANTIGUA; rota sin
//    fecha; sin_agenda no.
//  · textoConfirmacionCita — dice día, hora, doctor y clínica; no dice
//    tratamiento; deja la puerta del «no me viene bien».
// Salida: 0 = todo verde · 1 = algún rojo (se listan).

import { casarTratamiento, casarDoctor, horaPedidaDe, huecosPorBloques, sugerirPropuesta, quienesLoHacen, _interno } from "../app/lib/agenda/huecos-del-caso";
import { garantiaDe } from "../app/lib/agenda/garantia";
import { pegadaA, primerPar } from "../app/lib/agenda/separacion";
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

console.log("══ horaPedidaDe (22-09: «cualquier día a las 8:30»)");
ok(horaPedidaDe("cualquier día a las 8:30") === 8 * 60 + 30, "«a las 8:30» → 08:30");
ok(horaPedidaDe("sobre las 17h") === 17 * 60, "«sobre las 17h» → 17:00");
ok(horaPedidaDe("a las 5") === 17 * 60, "«a las 5» sin mañana → 17:00");
ok(horaPedidaDe("a las 9 de la mañana") === 9 * 60, "«a las 9 de la mañana» → 09:00");
ok(horaPedidaDe("martes por la tarde") === null, "sin hora → null (manda la franja)");
ok(horaPedidaDe("el 29.09 por la tarde") === null, "una fecha con punto no es una hora");
ok(horaPedidaDe(null) === null, "sin texto → null");

console.log("══ huecosPorBloques (el selector «Proponer horas»)");
{
  // Samuel: jueves por la mañana. Hoy martes 22-09. Molina todas las mañanas
  // y tardes; Ferrer el jueves por la mañana también.
  const HOY = "2026-09-22";
  const dias = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-10-01", "2026-10-08", "2026-10-15"];
  const s = dias.flatMap((f) => [slot(f, "10:00", "molina"), slot(f, "10:30", "molina"), slot(f, "13:00", "molina"), slot(f, "13:30", "molina"), slot(f, "16:00", "molina"), slot(f, "16:30", "molina"), slot(f, "19:00", "molina")]);
  s.push(slot("2026-09-24", "10:00", "ferrer"));
  const r = huecosPorBloques(s, { franja: "manana", dias: ["jue"], urgencia: null }, null, HOY);
  const fc = [...new Set(r.cumplen.map((x) => x.fecha))];
  ok(fc.join(",") === "2026-09-24,2026-10-01,2026-10-08", `cumplen: los tres jueves más cercanos, en orden (${fc.join(",")})`);
  ok(r.cumplen.every((x) => x.slot.inicio < 14 * 60), "cumplen: solo mañanas");
  ok(new Set(r.cumplen.filter((x) => x.fecha === "2026-09-24").map((x) => x.doctorId)).size === 2, "cumplen: cada doctor con sus horas (Molina y Ferrer el jueves 24)");
  const alt = r.alternativas.map((x) => `${x.fecha.slice(5)}@${x.slot.inicio / 60}`);
  ok(!r.alternativasPrimero, "sin prisa: primero lo que cumple");
  ok([...new Set(r.alternativas.map((x) => x.fecha))].join(",") === "2026-09-23,2026-09-24,2026-09-25", `alternativas: mañana del mié 23 y vie 25, y la tarde del jue 24 (${[...new Set(r.alternativas.map((x) => x.fecha))].join(",")})`);
  const tardeJue = r.alternativas.filter((x) => x.fecha === "2026-09-24").map((x) => x.slot.inicio / 60);
  ok(tardeJue.join(",") === "16,16.5,19", `de la otra franja, solo las ${_interno.DIAS_ALTERNATIVAS} horas más pegadas a la mañana (${tardeJue.join(",")})`);
  ok(!r.alternativas.some((x) => r.cumplen.includes(x)), "ninguna hora en los dos bloques");
  ok(alt.length > 0 && _interno.notaBloques(r, { franja: "manana", dias: ["jue"], urgencia: null }, null) === null, "si hay lo que pidió, no hace falta nota");

  // Cuanto antes y el primer jueves que encaja es dentro de 3 semanas.
  const lejos = s.filter((x) => !(x.fecha === "2026-09-24" || x.fecha === "2026-10-01" || x.fecha === "2026-10-08") || x.slot.inicio >= 14 * 60);
  const u = huecosPorBloques(lejos, { franja: "manana", dias: ["jue"], urgencia: "cuanto_antes" }, null, HOY);
  ok(u.alternativasPrimero && u.primeraQueCumple === "2026-10-15", `cuanto antes y lo que encaja es el 15-oct: las de antes van primero (${u.primeraQueCumple})`);
  ok(u.alternativas.every((x) => x.fecha < "2026-10-15") && u.alternativas[0]?.fecha === "2026-09-23", "las alternativas son las de ANTES, desde la más cercana a hoy");
  ok((_interno.notaBloques(u, { franja: "manana", dias: ["jue"], urgencia: "cuanto_antes" }, null) ?? "").startsWith("Pidió cuanto antes y lo primero que encaja es el jueves"), `y se dice arriba: «${_interno.notaBloques(u, { franja: "manana", dias: ["jue"], urgencia: "cuanto_antes" }, null)}»`);
  const sinPrisa = huecosPorBloques(lejos, { franja: "manana", dias: ["jue"], urgencia: "sin_prisa" }, null, HOY);
  ok(!sinPrisa.alternativasPrimero, "sin prisa: el orden de siempre aunque esté lejos");
  const cerca = huecosPorBloques(s, { franja: "manana", dias: ["jue"], urgencia: "cuanto_antes" }, null, HOY);
  ok(!cerca.alternativasPrimero, "cuanto antes pero el jueves que encaja es pasado mañana: no se reordena");
}
{
  // Verónica: martes por la tarde, un doctor. La mañana del martes, solo lo último.
  const HOY = "2026-09-22";
  const f = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-06", "2026-10-13", "2026-10-20"];
  const s = f.flatMap((d) => ["09:00", "12:40", "13:00", "13:20", "13:40", "16:00", "16:20", "18:40"].map((h) => slot(d, h, "castano")));
  const r = huecosPorBloques(s, { franja: "tarde", dias: ["mar"], urgencia: null }, null, HOY);
  ok([...new Set(r.cumplen.map((x) => x.fecha))].join(",") === "2026-09-29,2026-10-06,2026-10-13", "cumplen: tres martes (la ventana de 4 semanas llega)");
  const manMar = r.alternativas.filter((x) => x.fecha === "2026-09-29").map((x) => x.slot.inicio);
  ok(manMar.join(",") === [13 * 60, 13 * 60 + 20, 13 * 60 + 40].join(","), `la mañana del martes: solo las tres últimas (${manMar.join(",")})`);
  ok(r.alternativas.some((x) => x.fecha === "2026-09-28" && x.slot.inicio >= 14 * 60), "y las tardes de los días de al lado");
}
{
  // «Martes a las 9:30»: esa hora con cada doctor, y alrededor debajo.
  const HOY = "2026-09-22";
  const s = ["2026-09-29", "2026-10-06"].flatMap((d) => [slot(d, "09:00", "a"), slot(d, "09:30", "a"), slot(d, "09:30", "b"), slot(d, "10:00", "b"), slot(d, "12:00", "a")]);
  s.push(slot("2026-09-24", "09:30", "a"));
  const r = huecosPorBloques(s, { franja: null, dias: ["mar"], urgencia: null }, 9 * 60 + 30, HOY);
  ok(r.cumplen.length === 4 && r.cumplen.every((x) => x.slot.inicio === 9 * 60 + 30), `cumplen: las 9:30 de los dos doctores, los dos martes (${r.cumplen.length})`);
  ok(!r.cumplen.some((x) => x.fecha === "2026-09-24"), "el jueves a las 9:30 no es lo que pidió");
  const alrededor = r.alternativas.map((x) => x.slot.inicio / 60);
  ok(alrededor.length === 4 && !alrededor.includes(12), `alrededor: 9:00 y 10:00 de esos martes, no las 12:00 (${alrededor.join(",")})`);
  // Nada a esa hora: las más cercanas del día, no el día entero.
  const diaEntero = ["10:00", "10:20", "10:40", "11:00", "11:20", "13:40", "16:00", "19:40"].map((h) => slot("2026-09-23", h));
  const c = huecosPorBloques(diaEntero, null, 8 * 60 + 30, HOY);
  ok(c.cumplen.length === 0 && c.alternativas.map((x) => x.slot.inicio / 60).join(",") === "10,10.333333333333334,10.666666666666666,11",
    `abre a las 10 y pidió las 8:30 → de 10:00 a 11:00 (${c.alternativas.map((x) => x.slot.inicio).join(",")})`);
  ok(_interno.notaBloques(c, null, 8 * 60 + 30) === "No hay nada a las 8:30 en cuatro semanas: estas son las horas más cercanas.", `y lo dice: «${_interno.notaBloques(c, null, 8 * 60 + 30)}»`);
}
{
  // «Cualquier día por la mañana»: días consecutivos desde hoy.
  const muchos = Array.from({ length: 9 }, (_, i) => slot(`2026-10-0${i + 1}`, "10:00"));
  const r = huecosPorBloques(muchos, { franja: "manana", dias: [], urgencia: null }, null, "2026-09-30");
  ok([...new Set(r.cumplen.map((x) => x.fecha))].join(",") === "2026-10-01,2026-10-02,2026-10-03", `cualquier mañana: los ${_interno.DIAS_CUMPLEN} días seguidos desde hoy`);
  const nada = huecosPorBloques(muchos, null, null, "2026-09-30");
  ok(nada.alternativas.length === 0 && nada.cumplen.length === 3, "sin preferencia: todo cumple, sin alternativas de relleno");
}
console.log("══ sugerirPropuesta (la propuesta ya hecha: selector, repuesto y agente)");
{
  const h = (fecha: string, hora: string, doctorId: string, bloque: "cumple" | "alternativa" = "cumple") => ({ fecha, hora, doctorId, bloque });
  const jueves = ["2026-09-24", "2026-10-01", "2026-10-08"].flatMap((f) => [
    ...["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"].map((x) => h(f, x, "ferrer")),
    ...["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"].map((x) => h(f, x, "molina")),
  ]);
  const sam = sugerirPropuesta(jueves, { alternativasPrimero: false, horaPedida: null });
  const txt = (l: { fecha: string; hora: string; doctorId: string }[]) => l.map((x) => `${x.fecha.slice(5)} ${x.hora} ${x.doctorId}`).join(" · ");
  ok(txt(sam) === "09-24 09:00 ferrer · 10-01 10:00 molina · 10-08 11:00 ferrer", `Samuel: días distintos, doctores alternos, horas distintas (${txt(sam)})`);
  const martes = ["2026-09-29", "2026-10-06", "2026-10-13"].flatMap((f) => ["16:00", "16:20", "16:40", "17:00", "17:20", "17:40", "18:00", "18:20", "18:40"].map((x) => h(f, x, "castano")));
  const ver = sugerirPropuesta(martes, { alternativasPrimero: false, horaPedida: null });
  ok(txt(ver) === "09-29 16:00 castano · 10-06 17:00 castano · 10-13 18:00 castano", `Verónica: un doctor, tres martes a horas distintas (${txt(ver)})`);
  const pedida = sugerirPropuesta(martes, { alternativasPrimero: false, horaPedida: 17 * 60 });
  ok(pedida.every((x) => x.hora === "17:00"), `pidió las 17:00: esa hora en los tres martes (${txt(pedida)})`);
  // Un solo día que cumple: otra hora de ESE día (≥ 60 min) antes que una alternativa.
  const unDia = [h("2026-09-29", "16:00", "c"), h("2026-09-29", "16:20", "c"), h("2026-09-29", "17:20", "c"), h("2026-09-30", "16:00", "c", "alternativa")];
  const u = sugerirPropuesta(unDia, { alternativasPrimero: false, horaPedida: null });
  ok(txt(u) === "09-29 16:00 c · 09-29 17:20 c · 09-30 16:00 c", `un solo martes: 16:00 y 17:20 (nunca 16:20), y completa con la alternativa (${txt(u)})`);
  ok(u.every((x, i) => u.slice(i + 1).every((y) => y.fecha !== x.fecha || Math.abs(Number(y.hora.slice(0, 2)) * 60 + Number(y.hora.slice(3)) - Number(x.hora.slice(0, 2)) * 60 - Number(x.hora.slice(3))) >= 60)), "nunca dos del mismo día a menos de 60 min");
  // Prisa y lo que cumple lejos: dos de antes y una que cumple.
  const prisa = [h("2026-10-15", "09:00", "f"), h("2026-10-15", "11:00", "f"), h("2026-09-23", "10:00", "m", "alternativa"), h("2026-09-25", "10:00", "m", "alternativa"), h("2026-09-28", "10:00", "m", "alternativa")];
  const p = sugerirPropuesta(prisa, { alternativasPrimero: true, horaPedida: null });
  ok(p.filter((x) => x.bloque === "alternativa").length === 2 && p.some((x) => x.fecha === "2026-10-15"), `con prisa: dos de antes y la que cumple (${txt(p)})`);
  // Repuesto: las vivas cuentan y ocupan sitio.
  const rep = sugerirPropuesta(martes, { alternativasPrimero: false, horaPedida: null, ya: [{ fecha: "2026-09-29", hora: "16:00", doctorId: "castano" }, { fecha: "2026-10-06", hora: "17:00", doctorId: "castano" }] });
  ok(rep.length === 1 && txt(rep) === "10-13 18:00 castano", `repuesto con dos vivas: añade UNA, en otro día y a otra hora (${txt(rep)})`);
  ok(sugerirPropuesta([], { alternativasPrimero: false, horaPedida: null }).length === 0, "sin huecos, sin propuesta");
  ok(_interno.FIN_MANANA_MIN === 15 * 60 && _interno.enFranja(14 * 60 + 20, "manana") && _interno.enFranja(15 * 60, "tarde"), "la tarde empieza a las 15:00 (las 14:20 son mañana)");
}

console.log("══ casarDoctor (solo si la paciente lo pidió)");
{
  const DOCS = [{ nombre: "Dr. Andrés Molina" }, { nombre: "Dra. Lucía Ferrer" }];
  ok(casarDoctor("con la doctora Ferrer", DOCS)?.nombre === "Dra. Lucía Ferrer", "«con la doctora Ferrer» → Dra. Lucía Ferrer");
  ok(casarDoctor("el doctor", DOCS) === null, "«el doctor» a secas → ninguno (no se elige solo)");
  ok(casarDoctor(null, DOCS) === null, "sin petición → ninguno (todos los doctores)");
}

console.log("══ separacion (22-09: el MENSAJE no lleva horas pegadas; el listado sí las enseña)");
{
  const a = (fecha: string, hora: string) => ({ fecha, hora });
  ok(pegadaA(a("2026-09-29", "14:20"), [a("2026-09-29", "14:00")])?.hora === "14:00", "14:20 junto a 14:00 → pegada");
  ok(pegadaA(a("2026-09-29", "15:00"), [a("2026-09-29", "14:00")]) === null, "15:00 junto a 14:00 → se separa (60 min justos)");
  ok(pegadaA(a("2026-09-30", "14:00"), [a("2026-09-29", "14:00")]) === null, "misma hora, otro día → no pegada");
  ok(primerPar([a("2026-09-29", "14:00"), a("2026-10-06", "14:00"), a("2026-09-29", "14:40")]) != null, "una propuesta con 14:00 y 14:40 el mismo día → rechazada");
  ok(primerPar([a("2026-09-29", "14:00"), a("2026-10-06", "14:00")]) === null, "martes y martes siguiente a la misma hora → vale");
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

console.log("══ quienesLoHacen (062, MEJORAS 265)");
{
  const docs = [{ id: "ferrer" }, { id: "molina" }, { id: "villalba" }];
  const asig = [
    { staff_id: "ferrer", especialidad_id: "general" },
    { staff_id: "molina", especialidad_id: "implantes" },
    { staff_id: "villalba", especialidad_id: "orto" },
    { staff_id: "villalba", especialidad_id: "general" },
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");
  ok(ids(quienesLoHacen(null, docs, asig)) === "ferrer,molina,villalba", "sin especialidad en el tratamiento: todos, como antes");
  ok(ids(quienesLoHacen("general", docs, asig)) === "ferrer,villalba", "con especialidad: solo sus doctores (un doctor puede tener dos)");
  ok(ids(quienesLoHacen("implantes", docs, asig)) === "molina", "el implantólogo no recibe revisiones y sí implantes");
  ok(quienesLoHacen("estetica", docs, asig).length === 0, "especialidad sin doctores: vacío, no se rellena con los demás");
}

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ todo verde");
process.exit(rojos ? 1 : 0);
