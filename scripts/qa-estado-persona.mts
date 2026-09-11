#!/usr/bin/env tsx
// scripts/qa-estado-persona.mts — la regla del estado de la persona, sin
// modelo y sin base (= npm run qa:estado-persona).
//
// Cubre los cuatro hallazgos de Simon del 11-09 en los hilos simulados:
//   · Nuria: una cita DECLINADA cierra el objetivo (no se vuelve a pedir día).
//   · Pablo: «qué quiere» sale del estado/tema, no del objetivo de relleno.
//   · Rosa: con queja no hay recordatorio de cobro — y si el modelo lo cuela,
//     se quita la frase sin tocar el resto.
//   · Lucía (hija de Carmen): la frase de la entrega lleva su nombre.
// Y las guardas de diseño: el fallback ofensivo sigue vivo con tema neutro.

import {
  estadoDeLaPersona,
  objetivoActivoDe,
  objetivosElegibles,
  queQuiereDe,
  sinRecuerdoDeCobro,
  citaDeclinada,
} from "../app/lib/agente/estado-persona";
import { FRASE_RECUERDO_COBRO } from "../app/lib/agente/entrada-desde-contexto";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

console.log("\n1 · estadoDeLaPersona: tres juicios del modelo, una decisión de código");
ok("urgencia gana a todo", estadoDeLaPersona({ urgenciaMedica: true, peticionOQueja: true, malestar: true }) === "urgencia");
ok("petición + malestar = queja", estadoDeLaPersona({ urgenciaMedica: false, peticionOQueja: true, malestar: true }) === "queja");
ok("petición sin malestar = petición", estadoDeLaPersona({ urgenciaMedica: false, peticionOQueja: true, malestar: false }) === "peticion");
ok("malestar sin petición NO es estado (el juicio dice que solo significa con peticionOQueja)", estadoDeLaPersona({ urgenciaMedica: false, peticionOQueja: false, malestar: true }) === null);
ok("nada → null", estadoDeLaPersona({ urgenciaMedica: false, peticionOQueja: false, malestar: false }) === null);

console.log("\n2 · objetivoActivoDe: el estado manda; la cita declinada no es elegible; el fallback sigue vivo");
{
  const abiertas = ["cita", "identificar"] as const;
  ok("tema cita abierto → cita", objetivoActivoDe({ tema: "cita", abiertas, campos: {}, estado: null }) === "cita");
  ok("tema otro con objetivos abiertos → el de mayor precedencia (diseño ofensivo: «hola» sigue abriendo)",
    objetivoActivoDe({ tema: "otro", abiertas, campos: {}, estado: null }) === "cita");
  ok("con QUEJA → ninguno, aunque el tema sea cita", objetivoActivoDe({ tema: "cita", abiertas, campos: {}, estado: "queja" }) === null);
  ok("con URGENCIA → ninguno", objetivoActivoDe({ tema: "cita", abiertas, campos: {}, estado: "urgencia" }) === null);
  ok("con PETICIÓN → ninguno", objetivoActivoDe({ tema: "otro", abiertas, campos: {}, estado: "peticion" }) === null);
  const declinada = { cita: { motivo_no_cita: "ya tiene cita programada; solo preguntaba por la sedación" } };
  ok("cita DECLINADA → deja de ser elegible", JSON.stringify(objetivosElegibles(abiertas, declinada)) === JSON.stringify(["identificar"]));
  ok("cita declinada + tema cita → cae al siguiente elegible, no a cita",
    objetivoActivoDe({ tema: "cita", abiertas, campos: declinada, estado: null }) === "identificar");
  ok("cita declinada y nada más abierto → null (solo contestar)",
    objetivoActivoDe({ tema: "otro", abiertas: ["cita"], campos: declinada, estado: null }) === null);
  ok("motivo_no_cita = no_aplica NO es declinar", !citaDeclinada({ cita: { motivo_no_cita: "no_aplica" } }));
  ok("motivo_no_cita = null NO es declinar", !citaDeclinada({ cita: { motivo_no_cita: null } }));
  ok("motivo_no_cita vacío NO es declinar", !citaDeclinada({ cita: { motivo_no_cita: "  " } }));
}

console.log("\n3 · queQuiereDe: el titular en lenguaje de coordinadora");
{
  // Pablo: se queja de un cobro; solo tiene «cita» abierta (pagó de más).
  ok("Pablo — queja + tema cobro sin cobro abierto → «Se queja de un pago…», no «Quiere cita»",
    queQuiereDe({ estado: "queja", tema: "cobro", abiertas: ["cita"], campos: { cita: { nombre_completo: "Pablo" } } }) === "Se queja de un pago — lo tiene que ver una persona");
  ok("Pablo turno 1 (sin queja marcada) — tema cobro sin cobro abierto → «Pregunta por un pago»",
    queQuiereDe({ estado: null, tema: "cobro", abiertas: ["cita"], campos: { cita: { nombre_completo: "Pablo" } } }) === "Pregunta por un pago");
  // Rosa: queja del trato, tema otro.
  ok("Rosa — queja con tema otro → «Se queja — lo tiene que ver una persona»",
    queQuiereDe({ estado: "queja", tema: "otro", abiertas: ["cita"], campos: {} }) === "Se queja — lo tiene que ver una persona");
  ok("petición rutinaria → «Pide hablar con una persona»",
    queQuiereDe({ estado: "peticion", tema: "cita", abiertas: ["cita"], campos: {} }) === "Pide hablar con una persona por una cita");
  ok("urgencia → «Urgencia — pide que le vean ya»",
    queQuiereDe({ estado: "urgencia", tema: "cita", abiertas: ["cita", "identificar"], campos: {} }) === "Urgencia — pide que le vean ya");
  // Nuria: declinó la cita.
  ok("Nuria — cita declinada, tema otro → «No quiere cita — …motivo»",
    queQuiereDe({ estado: null, tema: "otro", abiertas: ["cita"], campos: { cita: { motivo_no_cita: "ya tiene cita programada; solo preguntaba", tratamiento_o_molestia: "extracción" } } }) === "No quiere cita — ya tiene cita programada; solo preguntaba");
  ok("cita declinada, tema cita → también «No quiere cita — …»",
    queQuiereDe({ estado: null, tema: "cita", abiertas: ["cita"], campos: { cita: { motivo_no_cita: "quiere el precio antes de venir" } } }) === "No quiere cita — quiere el precio antes de venir");
  // El caso normal sigue igual que antes (qa:ficha lo afirma con datos).
  ok("tema cita abierto con datos → «Quiere cita — …» en el orden de la definición",
    queQuiereDe({ estado: null, tema: "cita", abiertas: ["cita"], campos: { cita: { disponibilidad: "tardes", tratamiento_o_molestia: "empezar su tratamiento", urgencia: "sin prisa", preferencia_doctor: "no_aplica" } } }) === "Quiere cita — empezar su tratamiento · sin prisa · tardes");
  ok("tema otro, objetivo de relleno CON datos → su frase (lo recogido no se esconde)",
    queQuiereDe({ estado: null, tema: "otro", abiertas: ["cita"], campos: { cita: { tratamiento_o_molestia: "revisión" } } }) === "Quiere cita — revisión");
  ok("tema otro, objetivo de relleno SIN datos → «Aún no ha dicho qué quiere» (no «Quiere cita» a quien dijo «hola»)",
    queQuiereDe({ estado: null, tema: "otro", abiertas: ["cita", "identificar"], campos: {} }) === "Aún no ha dicho qué quiere");
  ok("sin objetivos abiertos y tema otro → null (solo conversación)",
    queQuiereDe({ estado: null, tema: "otro", abiertas: [], campos: {} }) === null);
}

console.log("\n4 · sinRecuerdoDeCobro: quita la coletilla, conserva el resto");
{
  const rosa = "Rosa, lamento mucho lo que pasó ayer. Un responsable se pondrá en contacto contigo en breve. Por cierto: tienes un pago pendiente con la clínica — administración te lo confirma cuando quieras, sin prisa.";
  const limpio = sinRecuerdoDeCobro(rosa, FRASE_RECUERDO_COBRO);
  ok("la coletilla del código desaparece", !FRASE_RECUERDO_COBRO.test(limpio));
  ok("el resto queda intacto", limpio === "Rosa, lamento mucho lo que pasó ayer. Un responsable se pondrá en contacto contigo en breve.");
  const modelo = "¡Hola Lucía! Claro, te hacemos una revisión sin problema. Por cierto, tienes un pago pendiente; administración te lo confirma. ¿Qué días te vienen mejor?";
  const l2 = sinRecuerdoDeCobro(modelo, FRASE_RECUERDO_COBRO);
  ok("la variante del modelo (en medio) también", !FRASE_RECUERDO_COBRO.test(l2) && l2.startsWith("¡Hola Lucía!") && l2.endsWith("¿Qué días te vienen mejor?"));
  ok("si TODO era coletilla → cadena vacía (el caller pone la plantilla)", sinRecuerdoDeCobro("Tienes un pago pendiente.", FRASE_RECUERDO_COBRO) === "");
  ok("sin coletilla → igual", sinRecuerdoDeCobro("Gracias, Ana. Seguimos por aquí.", FRASE_RECUERDO_COBRO) === "Gracias, Ana. Seguimos por aquí.");
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s) — la regla del estado de la persona no se cumple`);
  process.exit(1);
}
console.log("\n✓ estado de la persona: el estado manda, la cita declinada cierra, el titular es honesto, el cobro no se cuela");
