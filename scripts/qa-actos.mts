#!/usr/bin/env tsx
// scripts/qa-actos.mts — los actos del agente (fase 1 en sombra), sin modelo
// y sin base (= npm run qa:actos).
//
//   · actoDelCodigo: el acto que hizo el código, en el ORDEN en que decide.
//   · canonizarActo: el borde («Acompañar» = acompanar; fuera de catálogo = null).
//   · parsearSombra: el JSON de la sombra (con y sin ruido; acto ilegible contable).
//   · tardanzaDe / agregarTardanza: la ENTREGA TARDÍA — los mensajes que el
//     paciente siguió contestando con el caso ya listo, y el agregado por
//     decisor (lo no medido no vale 0).
//     Esto prueba el CÁLCULO, no la captura: que `pudoEn` se apunte al jugar
//     (`ev.casoCompleto` en jugar-tres) y llegue al visor lo demuestra el
//     siguiente pase de `npm run hilos:tres`, que imprime la frase por hilo y
//     el agregado por decisor — coste de modelo, cubierto ahí (§25).
// Salidas: 0 · 1 hay fallos.

import {
  ACTOS,
  actoDelCodigo,
  agregarTardanza,
  canonizarActo,
  fraseTardanza,
  parsearSombra,
  tardanzaDe,
  DEFINICION_ACTO,
  type BanderasActo,
  type HiloTres,
  type ResumenTres,
} from "../app/lib/agente/actos";

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
  const libre = parsearSombra(JSON.stringify({ situacion: "s", conviene: "Que la vea el doctor hoy.", acto: "atender", mensaje: "m" }));
  ok("variante libre: «conviene» se lee; sin porQue → null", libre?.conviene === "Que la vea el doctor hoy." && libre.porQue === null && libre.acto === "atender");
  ok("sin «conviene» → null", sinPorQue?.conviene === null);
}

console.log("\n4 · entrega tardía: el turno en que se pudo vs el turno en que se entregó");
{
  const resumen = (p: Partial<ResumenTres>): ResumenTres => ({
    turnos: 6, derivoEn: null, motivo: null, causa: null, porHecho: false, datos: [], aplazados: [],
    repeticiones: 0, molestiaEn: null, fin: "derivado", detalleFin: null, costeUsd: 0, ...p,
  });
  // La distinción que sostiene toda la métrica: SIN la clave = jugado antes
  // de medirla; con la clave en null = se midió y el objetivo nunca se cubrió.
  const viejo = tardanzaDe(resumen({ derivoEn: 4 }));
  ok("hilo jugado antes de la métrica → «no medido», nunca 0 de más", viejo.estado === "no_medido" && viejo.turnosDeMas === null);
  ok("y su frase no promete ninguna cifra", !/\d/.test(fraseTardanza(viejo)));
  const sinCubrir = tardanzaDe(resumen({ pudoEn: null, derivoEn: 4 }));
  ok("medido y sin cubrir el objetivo → «sin contrato» (no es tardanza)", sinCubrir.estado === "sin_contrato" && sinCubrir.turnosDeMas === null);
  const aTiempo = tardanzaDe(resumen({ pudoEn: 3, derivoEn: 3 }));
  ok("entregó en el turno en que se pudo → a tiempo, 0 de más", aTiempo.estado === "a_tiempo" && aTiempo.turnosDeMas === 0);
  const tarde = tardanzaDe(resumen({ pudoEn: 2, derivoEn: 5 }));
  ok("se pudo en el 2 y entregó en el 5 → tarde, 3 de más", tarde.estado === "tarde" && tarde.turnosDeMas === 3);
  ok("y la frase lo dice con las dos cifras", fraseTardanza(tarde).includes("2") && fraseTardanza(tarde).includes("5") && fraseTardanza(tarde).includes("3 mensajes de más"));
  ok("singular: 1 mensaje de más", fraseTardanza(tardanzaDe(resumen({ pudoEn: 2, derivoEn: 3 }))).includes("1 mensaje de más"));
  const nunca = tardanzaDe(resumen({ pudoEn: 3, derivoEn: null, turnos: 6, fin: "perdido" }));
  ok("se pudo en el 3 y el hilo acabó sin entregar → nunca, 3 de más", nunca.estado === "nunca" && nunca.turnosDeMas === 3);
  const raro = tardanzaDe(resumen({ pudoEn: 5, derivoEn: 3 }));
  ok("entrega anterior a poder (dato imposible) → incoherente, no un 0 disfrazado", raro.estado === "incoherente" && raro.turnosDeMas === null);

  const hilo = (r: Partial<ResumenTres>): HiloTres => ({
    guionId: "g", titulo: "t", categoria: "c", decisor: "libre", version: "v", jugadoEl: "", mensajes: [], resumen: resumen(r), costeUsd: 0,
  });
  const a = agregarTardanza([
    hilo({ pudoEn: 2, derivoEn: 5 }),          // tarde, +3
    hilo({ pudoEn: 1, derivoEn: 2 }),          // tarde, +1
    hilo({ pudoEn: 4, derivoEn: 4 }),          // a tiempo
    hilo({ pudoEn: 2, derivoEn: null, turnos: 6, fin: "perdido" }), // nunca, +4
    hilo({ pudoEn: null, derivoEn: 3 }),       // sin cubrir
    hilo({ derivoEn: 3 }),                     // sin medir
    undefined,                                 // decisor no jugado
  ]);
  ok("el agregado cuenta 6 hilos y deja fuera el no jugado", a.hilos === 6);
  ok("medidos = a tiempo + tarde + nunca (ni «sin medir» ni «sin cubrir»)", a.medidos === 4 && a.aTiempo === 1 && a.tarde === 2 && a.nunca === 1);
  ok("los mensajes de más suman solo los que SÍ entregaron tarde (+4)", a.turnosDeMas === 4);
  ok("los que nunca entregaron van aparte (+4), no diluidos en la media", a.turnosDeMasNunca === 4);
  ok("«sin medir» y «sin cubrir» se cuentan y no se suman a nada", a.noMedidos === 1 && a.sinContrato === 1 && a.incoherentes === 0);
  ok("un agregado sin hilos no inventa denominador", agregarTardanza([]).medidos === 0 && agregarTardanza([]).turnosDeMas === 0);
}

console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ qa:actos en verde");
process.exit(fallos ? 1 : 0);
