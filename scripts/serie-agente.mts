#!/usr/bin/env tsx
// scripts/serie-agente.mts — CÓMO VA EL AGENTE, PASADA A PASADA (14-09-2026,
// encargo de Simon: «ninguna métrica dice si esto va mejor que hace una semana»).
//
//   npm run serie            la tabla de ingeniería
//   npm run serie -- --clinica   la misma medida en lenguaje de clínica
//
// SIN MODELO Y SIN BASE: lee lo YA pagado — los fixtures de `hilos:tres` y los
// juicios de `evals/pasadas/`. Coste $0. Por eso se puede correr siempre.
//
// LAS CUATRO COLUMNAS, Y POR QUÉ NO SE SUMAN EN UNA (condición de Simon):
//
//   A · LO QUE ESCRIBE — daños del BORRADOR por mensaje de agenda.
//   B · LO QUE SALE ___ — daños de lo ENVIADO por mensaje de agenda.
//   C · LO QUE CONSIGUE  — contrato cubierto, datos, en qué mensaje entrega.
//   D · LO QUE CUESTA __ — mensajes por caso y dólares por conversación.
//
// A y B JAMÁS se funden. El 14-09, A = 0 y B = 1: el agente escribía limpio y el
// guardián ensuciaba —podó una pregunta legítima y lo que quedó pasó a ser una
// promesa de reservar—. Un índice único habría dicho «1 daño» y habríamos ido a
// corregir al redactor por un fallo que no era suyo. Por eso la tabla enseña
// además **B − A, que es la medida del guardián**: positivo = ensucia,
// negativo = salva, cero = no hace nada.
//
// Y C no se funde con A/B porque son los dos tipos de fallo que NO se compensan:
// un agente mudo tiene A=0 y C=0 y es inútil; uno que promete huecos tiene C
// alto y A alto y es peligroso. Juntos en una tabla sí; en un número, no.
//
// §4 — lo que no consta sale como «—», nunca como 0. Las pasadas anteriores al
// 14-09 no guardaban su juicio con el nombre del fixture (dos del mismo día se
// pisaban), así que su daño puede no constar: eso es «no se midió», no «cero».
//
// Salidas: 0 · 1 sin fixtures.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Decisor, FixtureTres } from "../app/lib/agente/actos";
import { vetoDoctorDeterminista, vetoVocativoDeterminista } from "../app/lib/agente/juez-borrador";
import { GUIONES } from "./hilos-jugados-guiones.mts";

const DIR_FIXTURES = "evals/hilos-tres";
const DIR_PASADAS = "evals/pasadas";
const argv = process.argv.slice(2);
const paraClinica = argv.includes("--clinica");
const decisor = (argv.includes("--decisor") ? argv[argv.indexOf("--decisor") + 1] : "alcance") as Decisor;

if (!existsSync(DIR_FIXTURES)) {
  console.error(`✗ No existe ${DIR_FIXTURES} — no hay ninguna pasada que seguir.`);
  process.exit(1);
}

// ─── LA TERCERA CUENTA (14-09) ─────────────────────────────────────────────
//
// A y B cuentan `afirma` + `se arroga`, que son las dos familias de AGENDA. La
// pasada de la ficha dio A = 0/13 y era verdad: el nombre del doctor salió
// enviado tres veces y no movió ni una de las dos columnas, porque ese daño es
// de otra familia. Una serie que dice «todo bien» mientras eso pasa es
// exactamente el fallo silencioso que llevamos la semana cazando (Simon,
// 14-09), así que se cuenta aparte y NO se funde con las otras dos.
//
// Se mide con los MISMOS vetos deterministas que corren en producción
// (`vetoDoctorDeterminista`, `vetoVocativoDeterminista`), sobre el texto
// ENVIADO y sin modelo: coste $0, como el resto de la serie. Y se mide sobre lo
// que SALIÓ, no sobre lo que el control intervino — contar intervenciones
// habría dado cero justo en la pasada que motivó esto, porque lo que se coló no
// lo cazó nadie.
//
// El mundo del guion (el doctor de la ficha y el nombre de la persona) sale de
// la definición VIVA, la misma que usa `hilos:tres`: el fixture de `tres` solo
// guarda id, título y categoría.
function cuentaDeDatos(hilo: FixtureTres["hilos"][number]["decisores"][Decisor], guionId: string): { vuelca: number; inventa: number; mensajes: number } {
  const guion = GUIONES.find((g) => g.id === guionId);
  const mundo = guion?.mundo.paciente;
  // Los DOS nombres válidos, como en producción: el que consta y la pista del
  // perfil de WhatsApp, que el prompt autoriza para dirigirse a un desconocido.
  // Sin la segunda, «Hola Dani» a un lead cuyo perfil dice Dani sale como
  // nombre inventado — y no lo es.
  const nombrePersona = [mundo?.nombre, guion?.nombrePerfil].filter(Boolean).join(" ") || null;
  const constaDoctor = mundo?.doctor ? `Doctor que la atiende: ${mundo.doctor}` : "";
  let vuelca = 0;
  let inventa = 0;
  let mensajes = 0;
  for (const m of hilo?.mensajes ?? []) {
    if (m.quien !== "agente" || !(m.texto ?? "").trim()) continue;
    mensajes++;
    const dicho = (hilo?.mensajes ?? [])
      .filter((x) => x.quien !== "agente" && x.n <= m.n)
      .map((x) => x.texto ?? "")
      .join(" · ");
    const opts = { dichoPorLaPersona: dicho, nombrePersona };
    if (constaDoctor && vetoDoctorDeterminista(m.texto!, constaDoctor, opts)) vuelca++;
    if (vetoVocativoDeterminista(m.texto!, opts)) inventa++;
  }
  return { vuelca, inventa, mensajes };
}

type Fila = {
  fixture: string;
  fecha: string;
  hilos: number;
  // A y B: null = no consta (§4)
  danoBorrador: number | null;
  agendaBorrador: number | null;
  danoEnviado: number | null;
  agendaEnviado: number | null;
  cubierto: number;
  datos: number;
  entrega: number | null;
  mensajes: number;
  usd: number;
  /** C · LO QUE CUENTA DE ELLA: datos suyos que salieron sin que los pidiera. */
  vuelca: number;
  inventa: number;
};

/** El juicio de ESTE fixture, si se guardó. Nombre nuevo (14-09) primero; los
 *  viejos se buscan por contenido, que es donde consta a quién juzgaron. */
function juicioDe(fixture: string, enviado: boolean): { dano: number; agenda: number } | null {
  for (const f of readdirSync(DIR_PASADAS).filter((x) => x.includes("juicio") && x.endsWith(".json"))) {
    let j: { fixtureNuevo?: string; recuentos?: Record<string, { agenda: number; afirma: number; arroga: number }> };
    try {
      j = JSON.parse(readFileSync(`${DIR_PASADAS}/${f}`, "utf8"));
    } catch {
      continue;
    }
    const esEnviado = f.includes("-enviado");
    if (esEnviado !== enviado) continue;
    if ((j.fixtureNuevo ?? "").split("/").pop() !== fixture) continue;
    const r = j.recuentos?.[`nueva/${decisor}`];
    if (!r) continue;
    // EL DAÑO son las dos familias juntas — «afirma» (dice un hueco que no
    // consta) y «se arroga» (convierte lo que dijo ella en algo suyo)—, que es
    // como se ha contado desde el 13-09. `repite` NO es daño: es ruido.
    return { dano: r.afirma + r.arroga, agenda: r.agenda };
  }
  return null;
}

const filas: Fila[] = [];
for (const f of readdirSync(DIR_FIXTURES).filter((x) => x.startsWith("fixture") && x.endsWith(".json")).sort()) {
  const fx = JSON.parse(readFileSync(`${DIR_FIXTURES}/${f}`, "utf8")) as FixtureTres;
  const hilos = fx.hilos.map((h) => h.decisores[decisor]).filter((x): x is NonNullable<typeof x> => x != null);
  if (hilos.length === 0) continue;
  const b = juicioDe(f, false);
  const e = juicioDe(f, true);
  const entregas = hilos.map((h) => h.resumen.derivoEn).filter((x): x is number => x != null);
  const datos = fx.hilos.map((h) => cuentaDeDatos(h.decisores[decisor], h.guion.id));
  filas.push({
    fixture: f.replace(/^fixture-?/, "").replace(/\.json$/, "") || "base",
    // La fecha del hilo más nuevo: la del fichero miente si se filtró a mano.
    fecha: hilos.map((h) => h.jugadoEl).sort().pop()?.slice(0, 16).replace("T", " ") ?? "—",
    hilos: hilos.length,
    danoBorrador: b?.dano ?? null,
    agendaBorrador: b?.agenda ?? null,
    danoEnviado: e?.dano ?? null,
    agendaEnviado: e?.agenda ?? null,
    cubierto: hilos.filter((h) => h.resumen.pudoEn != null).length,
    datos: hilos.reduce((s, h) => s + h.resumen.datos.length, 0),
    entrega: entregas.length ? entregas.reduce((a, x) => a + x, 0) / entregas.length : null,
    mensajes: hilos.reduce((s, h) => s + h.mensajes.filter((m) => m.quien === "agente" && (m.texto ?? "").trim()).length, 0),
    usd: hilos.reduce((s, h) => s + (h.costeUsd ?? 0), 0),
    vuelca: datos.reduce((s, d) => s + d.vuelca, 0),
    inventa: datos.reduce((s, d) => s + d.inventa, 0),
  });
}

if (filas.length === 0) {
  console.error(`✗ Ningún fixture de ${DIR_FIXTURES} tiene hilos del decisor «${decisor}».`);
  process.exit(1);
}

const n = (v: number | null, d = 0) => (v == null ? "—" : v.toFixed(d));
const tasa = (dano: number | null, agenda: number | null) =>
  dano == null || agenda == null ? "—" : agenda === 0 ? "s/d" : `${dano}/${agenda}`;

if (!paraClinica) {
  console.log(`\nCÓMO VA EL AGENTE · decisor «${decisor}» · ${filas.length} pasadas · lo ya pagado, coste $0\n`);
  console.log("  pasada      cuándo             hilos   A escribe   B sale   B−A guardián   C vuelca   C inventa   cubierto   datos   entrega   msj    $/conv");
  console.log("  " + "─".repeat(136));
  for (const f of filas) {
    const dif = f.danoEnviado != null && f.danoBorrador != null ? f.danoEnviado - f.danoBorrador : null;
    const guardian = dif == null ? "—" : dif > 0 ? `+${dif} ENSUCIA` : dif < 0 ? `${dif} salva` : "0 no toca";
    console.log(
      `  ${f.fixture.padEnd(11)} ${f.fecha.padEnd(17)} ${String(f.hilos).padStart(4)}   ` +
        `${tasa(f.danoBorrador, f.agendaBorrador).padStart(9)}   ${tasa(f.danoEnviado, f.agendaEnviado).padStart(6)}   ` +
        `${guardian.padStart(12)}   ${`${f.vuelca}/${f.mensajes}`.padStart(8)}   ${`${f.inventa}/${f.mensajes}`.padStart(9)}   ` +
        `${`${f.cubierto}/${f.hilos}`.padStart(8)}   ${String(f.datos).padStart(5)}   ` +
        `${n(f.entrega, 2).padStart(7)}   ${String(f.mensajes).padStart(3)}   ${(f.usd / f.hilos).toFixed(3)}`,
    );
  }
  console.log(`
  A · lo que ESCRIBE el agente (daños / mensajes de agenda del borrador)
  B · lo que SALE al paciente (lo mismo, después del guardián)
  B−A · LA MEDIDA DEL GUARDIÁN: positivo = ensucia · negativo = salva · 0 = no toca
  C · LO QUE CUENTA DE ELLA, sobre lo ENVIADO y sin modelo (14-09): «vuelca» =
      mensajes que nombran al doctor de su ficha sin que ella lo sacara · «inventa»
      = mensajes que la llaman por un nombre que no es el suyo. NO se funden con A
      y B: son otra familia, y la pasada de la ficha dio A=0 con tres volcados.
      Un guion sin doctor en su ficha no puede volcar: ahí el 0 es del mundo.
  «—» = no consta (§4): esa pasada no guardó su juicio. No es 0.`);
} else {
  // LA MISma medida, en lenguaje de clínica (Simon, 14-09: «es exactamente lo
  // que le voy a enseñar a RB»). No se inventa ninguna cifra: se traducen las
  // mismas. «Se arroga» no significa nada fuera de aquí; «de cada diez casos,
  // cuántos llegan listos para llamar», sí.
  console.log(`\nEL AGENTE DE CITAS, PASADA A PASADA\n`);
  for (const f of filas) {
    const listos = Math.round((f.cubierto / f.hilos) * 10);
    const sostiene =
      f.danoEnviado == null || f.agendaEnviado == null || f.agendaEnviado === 0
        ? "sin medir"
        : `${Math.round((f.danoEnviado / f.agendaEnviado) * 10)} de cada 10`;
    console.log(`  ${f.fecha} · ${f.hilos} conversaciones`);
    console.log(`     · ${listos} de cada 10 casos llegan listos para llamar (sin volver a preguntar nada)`);
    console.log(`     · ${sostiene} mensajes sobre citas dicen algo que la clínica no puede sostener`);
    console.log(`     · ${f.mensajes === 0 ? "sin medir" : `${Math.round((f.vuelca / f.mensajes) * 10)} de cada 10`} mensajes le cuentan algo de su historial que no había preguntado`);
    console.log(`     · ${f.mensajes === 0 ? "sin medir" : `${Math.round((f.inventa / f.mensajes) * 10)} de cada 10`} mensajes la llaman por un nombre que no es el suyo`);
    console.log(`     · el caso se pasa al equipo en el mensaje ${n(f.entrega, 1)}, de media`);
    console.log(`     · coste por conversación: $${(f.usd / f.hilos).toFixed(3)}`);
  }
  console.log(`
  «Listos para llamar» = la coordinadora tiene lo que necesita para cerrar la cita
  sin volver a preguntarle nada a la persona.`);
}
process.exit(0);
