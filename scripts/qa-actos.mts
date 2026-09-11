#!/usr/bin/env tsx
// scripts/qa-actos.mts — los actos del agente (fase 1 en sombra), sin modelo
// y sin base (= npm run qa:actos).
//
//   · actoDelCodigo: el acto que hizo el código, en el ORDEN en que decide.
//   · canonizarActo: el borde («Acompañar» = acompanar; fuera de catálogo = null).
//   · parsearSombra: el JSON de la sombra (con y sin ruido; acto ilegible contable).
// Salidas: 0 · 1 hay fallos.

import { ACTOS, actoDelCodigo, canonizarActo, parsearSombra, DEFINICION_ACTO, type BanderasActo } from "../app/lib/agente/actos";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

const base: BanderasActo = {
  estado: null,
  pideNoContacto: false,
  insiste: false,
  vuelveSobreAplazado: false,
  casoCompleto: false,
  dudaClinicaAnotada: false,
  esperaHasta: null,
  recoge: false,
};
const con = (b: Partial<BanderasActo>) => actoDelCodigo({ ...base, ...b });

console.log("\n1 · actoDelCodigo: la precedencia del código");
ok("nada encendido → contestar", con({}) === "contestar");
ok("recoge → recoger", con({ recoge: true }) === "recoger");
ok("espera gana a recoger (se despide sin pedir)", con({ recoge: true, esperaHasta: "2026-09-20" }) === "parar");
ok("duda clínica gana a recoger (se acompaña)", con({ recoge: true, dudaClinicaAnotada: true }) === "acompanar");
ok("caso completo → cerrar", con({ casoCompleto: true, recoge: false }) === "cerrar");
ok("caso completo con duda clínica: el código cierra (ambigüedad que la sombra enseña)", con({ casoCompleto: true, dudaClinicaAnotada: true }) === "cerrar");
ok("vuelve sobre aplazado → reconocer, aunque el caso esté completo", con({ vuelveSobreAplazado: true, casoCompleto: true }) === "reconocer");
ok("insiste (deriva por insistencia) → reconocer", con({ insiste: true, vuelveSobreAplazado: true }) === "reconocer");
ok("petición de persona → atender, aunque recoja", con({ estado: "peticion", recoge: true }) === "atender");
ok("queja → atender", con({ estado: "queja", casoCompleto: true }) === "atender");
ok("opt-out gana a queja", con({ estado: "queja", pideNoContacto: true }) === "parar");
ok("urgencia gana a todo, incluso al opt-out", con({ estado: "urgencia", pideNoContacto: true, casoCompleto: true }) === "atender");
ok("«aclarar» no lo produce ninguna bandera del código", !Object.values({ a: con({}), b: con({ recoge: true }) }).includes("aclarar"));

console.log("\n2 · canonizarActo: el borde");
ok("«Acompañar» → acompanar", canonizarActo("Acompañar") === "acompanar");
ok("« RECOGER » → recoger", canonizarActo(" RECOGER ") === "recoger");
ok("«cerrar.» (con punto) → null (no se adivina)", canonizarActo("cerrar.") === null);
ok("fuera de catálogo → null", canonizarActo("derivar") === null);
ok("no string → null", canonizarActo(42) === null && canonizarActo(null) === null);
ok("todos los actos se canonizan a sí mismos", ACTOS.every((a) => canonizarActo(a) === a));
ok("todos los actos tienen definición", ACTOS.every((a) => DEFINICION_ACTO[a]?.etiqueta && DEFINICION_ACTO[a]?.que));

console.log("\n3 · parsearSombra: el JSON de la sombra");
{
  const limpio = parsearSombra(
    JSON.stringify({ situacion: "Tiene miedo al dolor y busca que la tranquilicen.", acto: "Acompañar", porQue: "Es una duda clínica.", mensaje: "Es normal, el doctor te lo explica." }),
  );
  ok("JSON limpio: situación, acto canónico, por qué, mensaje", limpio?.acto === "acompanar" && limpio.situacion.startsWith("Tiene") && limpio.porQue === "Es una duda clínica." && limpio.mensaje.startsWith("Es normal"));
  const conRuido = parsearSombra('Aquí tienes:\n```json\n{"situacion":"Prisa.","acto":"recoger","porQue":"x","mensaje":"¿Qué día te va bien?"}\n```');
  ok("con texto alrededor y fence: se extrae el JSON", conRuido?.acto === "recoger" && conRuido.mensaje.startsWith("¿Qué"));
  const ilegible = parsearSombra(JSON.stringify({ situacion: "s", acto: "escalar", mensaje: "m" }));
  ok("acto fuera de catálogo → ilegible, con el crudo al lado", ilegible?.acto === "ilegible" && ilegible.actoCrudo === "escalar");
  const sinMensaje = parsearSombra(JSON.stringify({ situacion: "s", acto: "recoger", mensaje: "" }));
  ok("sin mensaje → null (no hay nada que leer al lado del código)", sinMensaje === null);
  const sinSituacion = parsearSombra(JSON.stringify({ acto: "recoger", mensaje: "m" }));
  ok("sin situación → null", sinSituacion === null);
  ok("sin JSON → null", parsearSombra("no sé") === null);
  ok("JSON roto → null", parsearSombra("{\"situacion\": ") === null);
  const sinPorQue = parsearSombra(JSON.stringify({ situacion: "s", acto: "parar", mensaje: "m", porQue: "   " }));
  ok("porQue en blanco → null (no se inventa)", sinPorQue?.porQue === null && sinPorQue.acto === "parar");
}

console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ qa:actos en verde");
process.exit(fallos ? 1 : 0);
