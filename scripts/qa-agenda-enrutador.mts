#!/usr/bin/env tsx
// QA DEL ENRUTADOR DE AGENDA (14-09-2026) — determinista, SIN modelo ni base.
//
//   npx tsx scripts/qa-agenda-enrutador.mts   (= npm run qa:agenda-enrutador)
//
// Qué se prueba, y qué NO. El enrutador no decide: solo dice si un mensaje
// entra en el corpus. Así que aquí NO se comprueba ningún acierto de juicio —
// se comprueba lo único que puede fallar:
//
//   A · RECALL: los seis ejemplos con los que Simon encontró el fallo entran
//       TODOS, los cuatro que afirman y los cuatro que solo repiten.
//   B · QUE NO DECIDA: el mensaje legítimo y el ilegítimo del MISMO par entran
//       igual. Si alguien vuelve a meter criterio en la regex, esto falla —
//       que es exactamente lo que pasó cinco veces seguidas.
//   C · Las dos señales van separadas: `cuando` (el día) y `reserva` (el poder
//       de reservar) son dos daños distintos y no se fusionan.
//   D · Lo que no habla de agenda se queda fuera: laxo no es «todo».
//
// Salidas §9: 0 · 1.

import { senalDeAgenda, mencionaAgenda, ETIQUETAS_AGENDA, DEFINICION_ETIQUETA } from "../app/lib/agente/agenda-enrutador";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

console.log("QA del enrutador de agenda\n");
console.log("A · recall: los ejemplos del 14-09 entran todos en el corpus");

// Los que AFIRMAN un hueco (si el día no está libre, el mensaje se vuelve falso).
const AFIRMAN = [
  "Tenemos hueco el lunes 14, martes 15 y miércoles 16 por la tarde.",
  "Te tenemos anotada para el jueves de 18:00 a 19:00.",
  "Perfecto, Nuria. Tenemos tu cita para el sábado 19 de septiembre por la mañana.",
  "Dime qué día y te la reservo.",
];
// Los que solo REPITEN lo que trajo la persona (siguen en pie pase lo que pase).
const REPITEN = [
  "Anoto tu preferencia de lunes a jueves por la tarde.",
  "Te lo apunto para el martes 15; si no hay hueco, se buscará otro martes.",
  "Paso tu solicitud al equipo para que te confirmen hueco el miércoles o el jueves.",
  "¿Te viene bien que te la agendemos?",
];
for (const m of [...AFIRMAN, ...REPITEN]) {
  ok(`entra: «${m.slice(0, 52)}…»`, mencionaAgenda(m));
}

console.log("\nB · el enrutador NO decide: el par legítimo/ilegítimo entra igual");
const PARES: [string, string][] = [
  ["Tenemos hueco el martes a las 16:00.", "Me dices que te viene bien el martes a las 16:00 y se lo paso al equipo."],
  ["Te la reservo para el jueves.", "¿Te viene bien que te la reservemos para el jueves?"],
  ["Tenemos disponibilidad por las tardes de lunes a viernes.", "Abrimos de lunes a viernes de 17:00 a 20:00."],
];
for (const [a, b] of PARES) {
  ok(`los dos del par entran: «${a.slice(0, 34)}…» / «${b.slice(0, 34)}…»`, mencionaAgenda(a) && mencionaAgenda(b));
}

console.log("\nC · las dos señales van separadas (dos daños, dos preguntas)");
{
  const s = senalDeAgenda("Te la reservo.");
  ok("«te la reservo» sin día: señal de reserva, ninguna de cuándo", s.reserva.length > 0 && s.cuando.length === 0 && s.candidato);
}
{
  const s = senalDeAgenda("Te llamamos el jueves a las 10:30.");
  ok("«el jueves a las 10:30»: señal de cuándo (día y hora)", s.cuando.length >= 2 && s.candidato, s.cuando.join(" · "));
}
{
  const s = senalDeAgenda("Te tenemos anotada para el jueves de 18:00 a 19:00.");
  ok("el caso del jueves 18-19 dispara LAS DOS señales", s.cuando.length > 0 && s.reserva.length > 0);
}
{
  const s = senalDeAgenda("Ens queda un forat dimarts a les 17:00.");
  ok("catalán: «dimarts» entra (el veto léxico del 23-08 se lo saltaba)", s.candidato, s.cuando.join(" · "));
}
{
  const s = senalDeAgenda("We can see you on Monday at 5pm.");
  ok("inglés: «Monday at 5pm» entra", s.candidato, s.cuando.join(" · "));
}

console.log("\nC bis · la palabra «cita» a secas no basta (14-09, las 42 de Simon)");
{
  const fuera = [
    "Hola Lucía, perfecto. Solo para asegurarme: ¿la cita es para ti? ¿Y eres paciente nueva?",
    "Para la cita no necesitas traer nada especial, solo tu documento de identidad.",
    "Lo que te conviene es una primera cita con nuestro doctor para que valore.",
  ];
  for (const m of fuera) ok(`fuera: «${m.slice(0, 46)}…»`, !mencionaAgenda(m), senalDeAgenda(m).reserva.join(" · "));
  ok("pero la cita AFIRMADA sigue entrando: «cita confirmada», «tienes cita el martes»",
    mencionaAgenda("Cita confirmada, Lucía.") && mencionaAgenda("Tienes cita el martes."));
  ok("y con día entra igual: «tenemos tu cita para el sábado 19»",
    mencionaAgenda("Tenemos tu cita para el sábado 19 de septiembre."));
}

console.log("\nD · lo que no habla de agenda se queda fuera");
const FUERA = [
  "Gracias por escribirnos, te leo.",
  "La primera visita con el doctor incluye la revisión y las radiografías.",
  "El presupuesto son 1.200 € y se puede financiar.",
  "¿Has notado molestia al masticar?",
  "Un asesor te explicará las opciones de sedación consciente.",
];
for (const m of FUERA) ok(`fuera: «${m.slice(0, 46)}…»`, !mencionaAgenda(m), senalDeAgenda(m).cuando.join(" · "));

console.log("\nE · la escala de etiquetas está completa y definida");
ok("tres etiquetas, cada una con su frase del test", ETIQUETAS_AGENDA.length === 3 && ETIQUETAS_AGENDA.every((e) => DEFINICION_ETIQUETA[e].que.length > 30));

console.log("\nF · sin estado entre llamadas (las regexes son globales)");
{
  const m = "Te esperamos el martes a las 10:00.";
  const a = senalDeAgenda(m);
  const b = senalDeAgenda(m);
  ok("dos llamadas seguidas dan lo mismo", JSON.stringify(a) === JSON.stringify(b));
}

console.log(fallos === 0 ? "\n✓ Enrutador de agenda OK" : `\n✗ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
