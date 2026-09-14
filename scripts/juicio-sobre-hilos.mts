#!/usr/bin/env tsx
// scripts/juicio-sobre-hilos.mts — JUZGAR LOS MENSAJES NUEVOS, no el corpus
// viejo (14-09-2026, la medición de MEJORAS 237) = npm run agenda:juicio:hilos
//
// POR QUÉ EXISTE, y es toda la diferencia con `npm run agenda:juicio`: aquel
// pasa el juicio por los candidatos que Simon ETIQUETÓ y mide AL JUEZ contra su
// criterio. Esto es el otro sentido del tubo: el papel del agente cambió, así
// que los mensajes son otros, y el corpus etiquetado —que describe los mensajes
// de ayer— no puede decir nada sobre ellos. Aquí el JUEZ ES EL INSTRUMENTO (a
// 28/32 = 88 % en la vara del 14-09) y lo que se mide es al REDACTOR.
//
// Se lee de FIXTURES, nunca de la base, y no escribe en `agenda_corpus`: una
// pasada de medición que tocara esas filas dejaría las etiquetas de Simon
// colgando de mensajes que él no ha leído (ver el comentario de `rutaSalida` en
// jugar-tres.mts).
//
// LAS DOS CIFRAS, separadas a propósito porque son DOS DAÑOS distintos y
// fundirlos es lo que el rediseño del 14-09 deshizo:
//   · «afirma»     — se planta en un día o un hueco que nadie le dio;
//   · «se arroga»  — da por hecho que la reserva la cierra él.
// Y una tercera columna que no es daño pero sin la cual las otras dos engañan:
// CUÁNTOS mensajes hablan de agenda. Un agente que deje de hablar de fechas
// saca cero afirmaciones y es peor agente — es justo el riesgo que MEJORAS 237
// se apunta a sí misma (precisión que se vuelve pasividad). Por eso el
// denominador que se enseña es «mensajes del agente», no «candidatos».
//
// EL CONTROL (--contra) NO ES DECORACIÓN: rejugar con el MISMO prompt ya da
// mensajes distintos (el paciente simulado reacciona a otra cosa). Sin un
// decisor sin tocar en la misma pasada, una mejora de 2 sobre 12 no se
// distingue del ruido. Lo honesto es leer la variación de `alcance` CONTRA la
// de `libre`, que no ha cambiado.
//
//   npm run agenda:juicio:hilos -- --fixture <ruta> [--contra <ruta>]
//                                  [--decisores alcance,libre] [--enviado] [--dry]
//
// Se juzga el BORRADOR cuando el control cambió el mensaje: lo que se mide es
// lo que escribió el agente, no lo que dejó salir la poda.
//
// Necesita ANTHROPIC_API_KEY. Salidas: 0 · 1 no había nada que juzgar o quedó
// algo sin juicio · 2 entorno o mal uso.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DECISORES, ETIQUETA_DECISOR, type Decisor, type FixtureTres, type MensajeTres } from "../app/lib/agente/actos";
import { senalDeAgenda, type EtiquetaAgenda } from "../app/lib/agente/agenda-enrutador";
import { juzgarAgenda, MODELO_JUICIO_AGENDA, VERSION_JUICIO_AGENDA } from "../app/lib/agente/juicio-agenda";

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("✗ Falta ANTHROPIC_API_KEY.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? "") : null;
};
const dry = argv.includes("--dry");
const enviado = argv.includes("--enviado");
const rutaNueva = flag("--fixture");
const rutaContra = flag("--contra");
const decisores = (flag("--decisores")?.split(",").filter(Boolean) ?? [...DECISORES]) as Decisor[];
if (!rutaNueva) {
  console.error("✗ Falta --fixture <ruta>.");
  process.exit(2);
}
if (decisores.some((d) => !(DECISORES as readonly string[]).includes(d))) {
  console.error(`✗ --decisores admite ${DECISORES.join(", ")}.`);
  process.exit(2);
}

// Un candidato ≈ 900 tokens de entrada (el prompt cachea a partir del primero)
// y ~130 de salida. En haiku sale a ~$0,0016 — el mismo número que anuncia
// `agenda:juicio`, y si se separa del coste medido hay que corregirlo.
const COSTE_POR_CANDIDATO_USD = 0.0016;
const A_LA_VEZ = 4;

type Candidato = {
  fixture: string;
  guion: string;
  decisor: Decisor;
  n: number;
  texto: string;
  dichoPorLaPersona: string;
  /** El control cambió el mensaje: se juzga el borrador y se dice. */
  podado: boolean;
};

/** El texto que se juzga. Por defecto el BORRADOR cuando el control lo cambió
 *  (la misma regla que usa el corpus, `textoDelGuion`): mide AL REDACTOR.
 *
 *  Con `--enviado` se juzga lo que SALIÓ, que es otra pregunta y no menos
 *  importante: **qué le llega al paciente**. Las dos hacen falta y por separado,
 *  porque podar una frase no siempre mejora el mensaje — puede cortar la mitad
 *  verdadera y dejar la falsa. Correr las dos sobre la misma pasada es lo único
 *  que separa «el agente escribe mal» de «el guardián corta mal». */
const textoDelMensaje = (m: MensajeTres) => (enviado ? (m.texto ?? "") : (m.borrador ?? m.texto ?? "")).trim();

function candidatosDelFixture(ruta: string, etiqueta: string): { candidatos: Candidato[]; mensajesDeAgente: Record<string, number> } {
  if (!existsSync(ruta)) {
    console.error(`✗ No existe el fixture ${ruta} — esto es «no pude», no «está mal».`);
    process.exit(2);
  }
  const f = JSON.parse(readFileSync(ruta, "utf8")) as FixtureTres;
  const candidatos: Candidato[] = [];
  const mensajesDeAgente: Record<string, number> = {};
  for (const h of f.hilos) {
    for (const d of decisores) {
      const hilo = h.decisores[d];
      if (!hilo) continue;
      const ms = hilo.mensajes;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i]!;
        if (m.quien !== "agente") continue;
        const texto = textoDelMensaje(m);
        if (!texto) continue;
        mensajesDeAgente[d] = (mensajesDeAgente[d] ?? 0) + 1;
        if (!senalDeAgenda(texto).candidato) continue;
        // Lo que dijo la persona: su último mensaje antes de este. Es la mitad
        // de la pregunta del juez —sin ella no se puede saber QUIÉN puso el día.
        const dicho = [...ms.slice(0, i)].reverse().find((x) => x.quien === "paciente")?.texto ?? "";
        candidatos.push({
          fixture: etiqueta,
          guion: h.guion.id,
          decisor: d,
          n: m.n,
          texto,
          dichoPorLaPersona: dicho,
          podado: m.borrador != null && m.borrador.trim() !== (m.texto ?? "").trim(),
        });
      }
    }
  }
  return { candidatos, mensajesDeAgente };
}

const nueva = candidatosDelFixture(rutaNueva, "nueva");
const base = rutaContra ? candidatosDelFixture(rutaContra, "base") : null;
const todos = [...(base?.candidatos ?? []), ...nueva.candidatos];

console.log(
  `Juicio sobre hilos · versión del juez ${VERSION_JUICIO_AGENDA} · modelo ${MODELO_JUICIO_AGENDA}\n` +
    `Fixture ${rutaNueva}${rutaContra ? ` · contra ${rutaContra}` : ""} · decisores ${decisores.join(", ")} · se juzga ${enviado ? "LO QUE SALIÓ (después del control)" : "EL BORRADOR (lo que escribió el agente)"}\n` +
    `${todos.length} mensajes hablan de agenda (de ${Object.values(nueva.mensajesDeAgente).reduce((a, b) => a + b, 0) + Object.values(base?.mensajesDeAgente ?? {}).reduce((a, b) => a + b, 0)} del agente)`,
);
console.log(
  `GASTO ANUNCIADO: ~$${(todos.length * COSTE_POR_CANDIDATO_USD).toFixed(3)} ` +
    `(${todos.length} × ~$${COSTE_POR_CANDIDATO_USD}) — para medir si las tres reglas del papel (MEJORAS 237) bajan lo que el juez llama falso.`,
);
if (dry || todos.length === 0) {
  console.log(dry ? "\n--dry: no se ha llamado al modelo." : "\nNingún mensaje habla de agenda: no hay nada que juzgar.");
  process.exit(todos.length === 0 ? 1 : 0);
}

type Veredicto = Candidato & { etiqueta: EtiquetaAgenda | null; seArroga: boolean | null; porQue: string | null; costeUsd: number };
const veredictos: Veredicto[] = [];
let sinJuicio = 0;
let usdTotal = 0;

for (let i = 0; i < todos.length; i += A_LA_VEZ) {
  const lote = todos.slice(i, i + A_LA_VEZ);
  // UN REINTENTO, y no es comodidad: la API se satura y un fallo transitorio
  // silencioso vacía la tabla sin vaciar el informe. El 14-09 una pasada entera
  // salió con 4 juicios de 22 y la tabla se pintó igual de convincente.
  const rs = await Promise.all(
    lote.map(async (c) => {
      let r = await juzgarAgenda({ texto: c.texto, dichoPorLaPersona: c.dichoPorLaPersona });
      if (!r || r.etiqueta == null) r = await juzgarAgenda({ texto: c.texto, dichoPorLaPersona: c.dichoPorLaPersona });
      return { c, r };
    }),
  );
  for (const { c, r } of rs) {
    if (!r || r.etiqueta == null) {
      sinJuicio++;
      console.log(`  · sin juicio: ${c.fixture}/${c.decisor}/${c.guion}#${c.n}`);
      continue;
    }
    usdTotal += r.costeUsd ?? 0;
    veredictos.push({ ...c, etiqueta: r.etiqueta, seArroga: r.seArroga, porQue: r.porQue, costeUsd: r.costeUsd ?? 0 });
  }
  process.stdout.write(`\r  juzgados ${Math.min(i + A_LA_VEZ, todos.length)}/${todos.length}`);
}
console.log("");

type Recuento = { agente: number; agenda: number; afirma: number; repite: number; ninguno: number; arroga: number };
const recuento = (fixture: string, d: Decisor, mensajesDeAgente: number): Recuento => {
  const v = veredictos.filter((x) => x.fixture === fixture && x.decisor === d);
  return {
    agente: mensajesDeAgente,
    agenda: v.length,
    afirma: v.filter((x) => x.etiqueta === "afirma").length,
    repite: v.filter((x) => x.etiqueta === "repite").length,
    ninguno: v.filter((x) => x.etiqueta === "ninguno").length,
    arroga: v.filter((x) => x.seArroga === true).length,
  };
};

const linea = (etiqueta: string, r: Recuento) =>
  `  ${etiqueta.padEnd(26)} ${String(r.agente).padStart(3)} mensajes · ${String(r.agenda).padStart(3)} de agenda · ` +
  `AFIRMA ${String(r.afirma).padStart(2)} · SE ARROGA ${String(r.arroga).padStart(2)} · repite ${String(r.repite).padStart(2)} · ninguno ${String(r.ninguno).padStart(2)}`;

// §9 — UN RECUENTO CON AGUJEROS NO SE PINTA COMO UN RECUENTO. Si falló algún
// juicio, la tabla describe una muestra distinta de la que dice describir, y
// eso es peor que no tener tabla: se lee y se decide con ella.
if (sinJuicio > 0) {
  console.log("\n" + "!".repeat(78));
  console.log(`✗ ${sinJuicio} de ${todos.length} MENSAJES SE QUEDARON SIN JUICIO (la API falló dos veces seguidas).`);
  console.log("  LA TABLA DE ABAJO NO VALE: le faltan esos mensajes y no se sabe de qué lado caían.");
  console.log("  Vuelve a lanzarlo. No se ha escrito nada que dependa de estas cifras.");
  console.log("!".repeat(78));
}
console.log("\n" + "═".repeat(78));
console.log("LO QUE EL JUEZ DICE DE LOS MENSAJES (afirma = se planta en un día que nadie dio;");
console.log("se arroga = da por hecho que la reserva la cierra él). Son DOS daños, no uno.");
console.log("═".repeat(78));
for (const d of decisores) {
  if (base) console.log(linea(`${ETIQUETA_DECISOR[d]} · ANTES`, recuento("base", d, base.mensajesDeAgente[d] ?? 0)));
  console.log(linea(`${ETIQUETA_DECISOR[d]}${base ? " · AHORA" : ""}`, recuento("nueva", d, nueva.mensajesDeAgente[d] ?? 0)));
  if (base) {
    const a = recuento("base", d, 0);
    const b = recuento("nueva", d, 0);
    const signo = (n: number) => (n > 0 ? `+${n}` : String(n));
    console.log(`  ${"→ variación".padEnd(26)} afirma ${signo(b.afirma - a.afirma)} · se arroga ${signo(b.arroga - a.arroga)} · de agenda ${signo(b.agenda - a.agenda)}`);
  }
  console.log("");
}

// Los mensajes señalados, con el porqué del juez: la cifra sin los textos no
// se puede discutir, y Simon juzga leyendo.
const senalados = veredictos.filter((v) => v.etiqueta === "afirma" || v.seArroga === true);
if (senalados.length > 0) {
  console.log("─".repeat(78));
  console.log(`LOS ${senalados.length} MENSAJES SEÑALADOS, para leerlos:`);
  for (const v of senalados) {
    const que = [v.etiqueta === "afirma" ? "AFIRMA" : null, v.seArroga === true ? "SE ARROGA" : null].filter(Boolean).join(" + ");
    console.log(`\n  [${v.fixture}] ${ETIQUETA_DECISOR[v.decisor]} · ${v.guion} turno ${v.n} · ${que}${v.podado ? " · (borrador: el control lo cambió)" : ""}`);
    console.log(`    persona: «${v.dichoPorLaPersona.slice(0, 160)}»`);
    console.log(`    agente:  «${v.texto}»`);
    console.log(`    juez:    ${v.porQue ?? "(sin porqué)"}`);
  }
}

// 14-09 — EL NOMBRE LLEVA EL FIXTURE, y no es cosmética: hasta hoy dos juicios
// del mismo día se pisaban, así que la serie en el tiempo (`npm run serie`)
// solo podía leer el último y el resto de las pasadas se quedaban sin su daño
// medido. Con el fixture en el nombre, cada pasada conserva el suyo.
const etiquetaFixture = (rutaNueva ?? "").split("/").pop()?.replace(/\.json$/, "") ?? "sin-fixture";
const salida = `evals/pasadas/${new Date().toISOString().slice(0, 10)}-juicio-${etiquetaFixture}${enviado ? "-enviado" : "-borrador"}.json`;
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(
  salida,
  JSON.stringify(
    {
      en: new Date().toISOString(),
      versionJuez: VERSION_JUICIO_AGENDA,
      modelo: MODELO_JUICIO_AGENDA,
      fixtureNuevo: rutaNueva,
      fixtureBase: rutaContra,
      juzgado: enviado ? "enviado" : "borrador",
      decisores,
      costeUsd: usdTotal,
      sinJuicio,
      recuentos: Object.fromEntries(
        decisores.flatMap((d) => [
          [`nueva/${d}`, recuento("nueva", d, nueva.mensajesDeAgente[d] ?? 0)],
          ...(base ? [[`base/${d}`, recuento("base", d, base.mensajesDeAgente[d] ?? 0)] as const] : []),
        ]),
      ),
      veredictos,
    },
    null,
    1,
  ),
);

console.log("\n" + "═".repeat(78));
console.log(`coste medido $${usdTotal.toFixed(3)}${sinJuicio ? ` · ${sinJuicio} sin juicio` : ""} · detalle en ${salida}`);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
process.exit(sinJuicio > 0 ? 1 : 0);
