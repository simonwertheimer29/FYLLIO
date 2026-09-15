#!/usr/bin/env tsx
// scripts/qa-envio-automatico.mts — MODO B: el interruptor y las guardas
// (15-09-2026 = npm run qa:envio-automatico). SIN MODELO y SIN RED: todo lo
// que se prueba aquí es determinista, así que cuesta $0 y puede correr
// siempre.
//
// LO QUE VIGILA, y es lo que Simon puso como condición y no como extra: un
// agente que envía solo y NO PARA es la peor forma de perder a un paciente.
// Cada guarda tiene su caso, y el interruptor apagado tiene el suyo — porque
// el fallo más caro de esta pieza no es enviar de más: es enviar cuando nadie
// había dicho que se pudiera.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { envioAutomaticoActivo, salientesSeguidos, TOPE_SEGUIDOS_SIN_RESPUESTA } from "../app/lib/agente/envio-automatico";
import type { MensajeHilo } from "../app/lib/agente/evaluador";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? ` — ${extra}` : ""}`);
  if (!c) fallos++;
};
const conEntorno = (v: string | undefined, f: () => void) => {
  const antes = process.env["AGENTE_ENVIO_AUTOMATICO"];
  if (v === undefined) delete process.env["AGENTE_ENVIO_AUTOMATICO"];
  else process.env["AGENTE_ENVIO_AUTOMATICO"] = v;
  try {
    f();
  } finally {
    if (antes === undefined) delete process.env["AGENTE_ENVIO_AUTOMATICO"];
    else process.env["AGENTE_ENVIO_AUTOMATICO"] = antes;
  }
};

console.log("\n1 · el interruptor: apagado por defecto, y por cliente Y teléfono");
conEntorno(undefined, () => {
  ok("sin variable, NADIE envía solo (el modo A de siempre)", !envioAutomaticoActivo("DEMO", "+34667188097"));
});
conEntorno("", () => ok("vacía tampoco enciende a nadie", !envioAutomaticoActivo("DEMO", "+34667188097")));
conEntorno("DEMO:+34667188097", () => {
  ok("el teléfono nombrado, sí", envioAutomaticoActivo("DEMO", "+34667188097"));
  ok("otro teléfono del MISMO cliente, no", !envioAutomaticoActivo("DEMO", "+34600111222"));
  ok("el mismo teléfono de OTRO cliente, no", !envioAutomaticoActivo("CENTRAL", "+34667188097"));
  ok("el formato del teléfono no decide (espacios, guiones)", envioAutomaticoActivo("DEMO", "+34 667 18 80 97"));
});
conEntorno("DEMO:*", () => {
  ok("«*» enciende al cliente entero", envioAutomaticoActivo("DEMO", "+34600111222"));
  ok("pero solo a ESE cliente", !envioAutomaticoActivo("CENTRAL", "+34600111222"));
});
conEntorno("DEMO:+34667188097,CENTRAL:*", () => {
  ok("varias entradas conviven", envioAutomaticoActivo("DEMO", "+34667188097") && envioAutomaticoActivo("CENTRAL", "+34999888777"));
  ok("y no se contaminan entre sí", !envioAutomaticoActivo("DEMO", "+34999888777"));
});

console.log("\n2 · el freno que más importa: salientes SEGUIDOS sin respuesta");
const m = (direccion: "Entrante" | "Saliente", contenido = "x"): MensajeHilo => ({ direccion, contenido });
ok("hilo que acaba en entrante → 0 seguidos (la persona acaba de hablar)",
  salientesSeguidos([m("Saliente"), m("Entrante")]) === 0);
ok("cuenta los del final, no los del total",
  salientesSeguidos([m("Saliente"), m("Saliente"), m("Entrante"), m("Saliente")]) === 1);
ok("tres seguidos son tres",
  salientesSeguidos([m("Entrante"), m("Saliente"), m("Saliente"), m("Saliente")]) === 3);
ok("un hilo entero de salientes cuenta todos (el caso de hablar solo)",
  salientesSeguidos([m("Saliente"), m("Saliente")]) === 2);
ok("hilo vacío → 0", salientesSeguidos([]) === 0);
ok(`el tope es ${TOPE_SEGUIDOS_SIN_RESPUESTA} y frena ANTES de escribir el cuarto`,
  TOPE_SEGUIDOS_SIN_RESPUESTA === 3);

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ modo B: apagado por defecto, por cliente y teléfono, y el freno de hablar solo cuenta lo que dice contar");
process.exit(0);
