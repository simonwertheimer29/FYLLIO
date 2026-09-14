#!/usr/bin/env tsx
// scripts/juicio-agenda.mts — LA PASADA DEL JUICIO ESPECIALIZADO DE AGENDA
// (14-09-2026, pieza 2 del rediseño por falsabilidad) = npm run agenda:juicio
//
// Pasa el juicio nuevo por los MISMOS candidatos que etiquetó Simon y escribe
// su veredicto en las columnas `juicio_*` de `agenda_corpus`, al lado de la
// etiqueta de él. No veta nada, no toca ningún mensaje: es sombra.
//
//   npm run agenda:juicio -- --dry          cuánto costaría, sin llamar al modelo
//   npm run agenda:juicio                   los que aún no tienen juicio
//   npm run agenda:juicio -- --rejuzgar     también los que ya lo tienen
//   npm run agenda:juicio -- --origen hilos_jugados
//   npm run agenda:juicio -- --limite 10    para probar barato
//   npm run agenda:juicio -- --modelo claude-sonnet-5
//
// ESCRIBE SEGÚN AVANZA, uno a uno: si el pase muere a la mitad, lo juzgado
// queda guardado y la siguiente ejecución sigue donde se quedó (sin --rejuzgar
// no repite lo hecho). Lo contrario —acumular y guardar al final— es la forma
// de perder una pasada entera de modelo por un timeout del último candidato.
//
// Necesita ANTHROPIC_API_KEY y SUPABASE_DB_URL_APP. Salidas: 0 · 1 no había
// nada que juzgar o quedaron candidatos sin juicio · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { runWithCliente } from "../app/lib/cliente-contexto";
import { guardarJuicioAgenda, listarDesacuerdosAgenda } from "../app/lib/agente/agenda-corpus";
import { juzgarAgenda, MODELO_JUICIO_AGENDA, VERSION_JUICIO_AGENDA } from "../app/lib/agente/juicio-agenda";
import { compararAgenda, ORIGENES_CORPUS, type OrigenCorpus } from "../app/lib/agente/agenda-enrutador";

for (const v of ["ANTHROPIC_API_KEY", "SUPABASE_DB_URL_APP"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v}.`);
    process.exit(2);
  }
}

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const valor = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const dry = flag("--dry");
const rejuzgar = flag("--rejuzgar");
const modelo = valor("--modelo") ?? MODELO_JUICIO_AGENDA;
const limite = Number(valor("--limite") ?? "0") || 0;
const origenCrudo = valor("--origen");
if (origenCrudo && !(ORIGENES_CORPUS as readonly string[]).includes(origenCrudo)) {
  console.error(`✗ --origen admite: ${ORIGENES_CORPUS.join(", ")}`);
  process.exit(2);
}
const origen = origenCrudo as OrigenCorpus | null;

// Un candidato ≈ 900 tokens de entrada (el prompt cachea a partir del primero)
// y ~130 de salida. En haiku ($1/M entrada, $5/M salida) sale a ~$0,0016.
const COSTE_POR_CANDIDATO_USD = 0.0016;
// El pooler corta conexiones ociosas y la API tiene su propio límite: cuatro a
// la vez va rápido sin poner a nadie al borde.
const A_LA_VEZ = 4;

await runWithCliente("DEMO", async () => {
  const { filas } = await listarDesacuerdosAgenda();
  const delOrigen = origen ? filas.filter((f) => f.origen === origen) : filas;
  const pendientes = rejuzgar ? delOrigen : delOrigen.filter((f) => f.juicio.etiqueta == null);
  const aJuzgar = limite > 0 ? pendientes.slice(0, limite) : pendientes;

  console.log(
    `Juicio de agenda · versión ${VERSION_JUICIO_AGENDA} · modelo ${modelo}\n` +
      `Corpus: ${filas.length} candidatos${origen ? ` · material «${origen}»: ${delOrigen.length}` : ""} · ` +
      `${delOrigen.filter((f) => f.juicio.etiqueta != null).length} ya juzgados · ${aJuzgar.length} por juzgar`,
  );
  console.log(
    `GASTO ANUNCIADO: ~$${(aJuzgar.length * COSTE_POR_CANDIDATO_USD).toFixed(3)} ` +
      `(${aJuzgar.length} × ~$${COSTE_POR_CANDIDATO_USD}) — para medir si UN test de falsabilidad acierta donde la regla 5 del juez falla.`,
  );
  if (aJuzgar.length === 0) {
    console.log("\nNo hay nada que juzgar. Con --rejuzgar se vuelven a pasar los que ya tienen veredicto.");
    process.exit(1);
  }
  if (dry) {
    console.log("\n--dry: no se ha llamado al modelo ni escrito nada.");
    process.exit(0);
  }

  let guardados = 0;
  let sinJuicio = 0;
  let textoDivergente = 0;
  const descartes: string[] = [];
  let usd = 0;

  const cola = [...aJuzgar];
  const trabajador = async () => {
    for (;;) {
      const c = cola.shift();
      if (!c) return;
      const r = await juzgarAgenda({ texto: c.texto, dichoPorLaPersona: c.dichoPorLaPersona, modelo });
      if (!r) {
        sinJuicio++;
        console.log(`  ✗ ${c.hilo} · sin juicio (el modelo no contestó o la respuesta era ilegible)`);
        continue;
      }
      usd += r.costeUsd ?? 0;
      descartes.push(...r.descartes);
      if (r.etiqueta == null) {
        // §19 — fuera de vocabulario: contado, y NO se escribe. Una fila con
        // `juicio` nulo es indistinguible de una que nunca se juzgó.
        sinJuicio++;
        console.log(`  ✗ ${c.hilo} · etiqueta fuera de vocabulario — descartada y contada`);
        continue;
      }
      const { textoGuardado } = await guardarJuicioAgenda({
        candidato: c,
        etiqueta: r.etiqueta,
        seArroga: r.seArroga,
        porQue: r.porQue,
        version: r.version,
        modelo: r.modelo,
      });
      guardados++;
      // El texto congelado en la fila es el que vio Simon. Si el juicio ha
      // leído otro, la comparación estaría enfrentando dos mensajes distintos
      // y el número saldría sin que nadie lo supiera.
      if (textoGuardado !== c.texto) {
        textoDivergente++;
        console.log(`  ⚠ ${c.hilo} · se juzgó un texto DISTINTO del que se etiquetó — la comparación de esta fila no vale`);
      }
      const suyo = r.etiqueta;
      const mio = c.etiqueta;
      console.log(
        `  ${mio && mio !== suyo ? "≠" : "·"} ${c.hilo} · juicio=${suyo}${mio ? ` · Simon=${mio}` : " · (sin etiquetar)"}` +
          `${r.seArroga ? " · se arroga reservar" : ""} — «${(r.porQue ?? "").slice(0, 90)}»`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, cola.length) }, trabajador));

  // El recuento se hace releyendo, no con lo que este pase tenga en memoria:
  // así incluye lo juzgado en pasadas anteriores y es el mismo número que
  // enseña la pantalla.
  const { filas: despues } = await listarDesacuerdosAgenda();
  const cmp = compararAgenda(origen ? despues.filter((f) => f.origen === origen) : despues);

  console.log("\n" + "═".repeat(72));
  console.log(
    `Juzgados ahora: ${guardados}${sinJuicio ? ` · ${sinJuicio} sin juicio` : ""}` +
      `${descartes.length ? ` · ${descartes.length} descartes de vocabulario (${[...new Set(descartes)].slice(0, 3).join(", ")})` : ""}` +
      `${textoDivergente ? ` · ⚠ ${textoDivergente} con texto divergente` : ""}`,
  );
  console.log(`Coste MEDIDO: $${usd.toFixed(4)} (anunciado ~$${(aJuzgar.length * COSTE_POR_CANDIDATO_USD).toFixed(3)})`);
  console.log("─".repeat(72));
  console.log(
    `LA VARA (solo donde Simon dijo afirma o repite) · ${cmp.vara.acuerdo}/${cmp.vara.n}` +
      `${cmp.vara.pct != null ? ` = ${cmp.vara.pct} %` : ""}\n` +
      `  deja pasar una afirmación falsa: ${cmp.vara.dejaPasar} · veta algo verdadero: ${cmp.vara.vetaDeMas} · ni lo mira: ${cmp.vara.seLoSalta}`,
  );
  console.log(
    `APARTE — descartar lo obvio (los «ninguno» de Simon) · ${cmp.descarte.acuerdo}/${cmp.descarte.n}` +
      `${cmp.descarte.pct != null ? ` = ${cmp.descarte.pct} %` : ""} · se alarma de más: ${cmp.descarte.ruido}`,
  );
  console.log(
    `Segunda pregunta (¿se arroga reservar?) · ${cmp.reserva.acuerdo}/${cmp.reserva.n}` +
      `${cmp.reserva.pct != null ? ` = ${cmp.reserva.pct} %` : ""}`,
  );
  console.log(
    `Global ${cmp.global.acuerdo}/${cmp.global.n}` +
      `${cmp.global.pct != null ? ` = ${cmp.global.pct} %` : ""} — el número que halaga: lleva los «ninguno» dentro.`,
  );
  console.log("─".repeat(72));
  console.log("Léelo caso a caso en /sombra/agenda/desacuerdos. Apunta el coste en evals/pasadas/GASTO.md.");
  process.exit(sinJuicio > 0 ? 1 : 0);
});
