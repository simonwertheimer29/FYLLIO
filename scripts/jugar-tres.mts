#!/usr/bin/env tsx
// scripts/jugar-tres.mts — TRES CONVERSACIONES POR GUION, una por decisor
// (12-09-2026, encargo de Simon; = npm run hilos:tres).
//
// El experimento anterior comparaba turno a turno sobre un hilo que CONDUCÍA
// el código: los otros dos decisores respondían a un paciente ya frustrado
// por decisiones que no habían tomado — medía quién se adapta mejor al
// desastre del código, no quién lleva mejor la conversación. Esto juega, para
// cada guion, tres conversaciones COMPLETAS y SEPARADAS con el mismo perfil
// de paciente y el mismo primer mensaje; a partir de ahí cada una la lleva un
// decisor de principio a fin y el paciente simulado (sonnet) reacciona a lo
// que ESE decisor dijo:
//   A · codigo   — evaluarTurno tal cual producción (juez y vetos incluidos).
//   B · contexto — el modelo con la MISMA entrada que producción (objetivos
//                  y campos incluidos) decide el acto y redacta.
//   C · libre    — el modelo sin objetivos ni campos (renderEntradaLibre)
//                  decide y redacta.
//   D · alcance  — (13-09, dictado de Simon) la entrada de C MÁS su alcance y
//                  su objetivo en una frase (`renderAlcance`, derivada del
//                  nivel de agenda y del propósito del caso abierto), y su
//                  prompt MENOS la prohibición de agenda, que ese alcance ya
//                  cubre dicha como papel. Sigue sin ver la lista de campos.
//                  El nombre del comando sigue diciendo «tres» por historia.
// En B y C el evaluador corre igualmente cada turno: aporta los HECHOS
// (urgencia, queja, lo anotado, lo recogido) y hace avanzar la sesión como
// producción; pero el mensaje y la decisión de pasar el caso son del decisor
// (acto «atender» o «cerrar» = pasa a una persona y para). Las entregas
// obligatorias por hechos no se tocan: con urgencia, queja o mensaje no
// legible el hilo pasa a una persona en ese turno lo diga el decisor o no
// (se anota «por hecho»).
//
// 13-09 — EL CONTROL CORRE EN LOS TRES. Hasta hoy los mensajes de B y C
// salían tal cual y los vetos deterministas se pasaban «solo para enseñar si
// cazarían»: cada número medido describía un agente que en producción no
// existe, y la conclusión del 13-09 («ninguna guarda lo paró») era a medias
// «ninguna guarda corrió». Ahora B y C pasan por `controlarMensajeDelDecisor`
// — la MISMA secuencia que producción (veto → juez → poda → una reescritura →
// descarte) sobre los MISMOS datos que constan (`renderDatosQueConstan`)—.
// Una sola diferencia, deliberada: el reemplazo de un descarte es la
// plantilla NEUTRA, que no recoge datos. Producción usa la que SÍ recoge
// porque tiene los campos delante; dárselos aquí a un decisor al que no se
// los damos sería el código recogiendo y la cifra apuntada al modelo.
//
// La entrada de cada turno la construye el MISMO constructor que el banco de
// pruebas (`construirEntradaDePrueba`, vigilado por qa:banco-vs-runner) sobre
// el mundo que vio el evaluador en el turno 1 del fixture de hilos jugados;
// las cadencias del guion se inyectan con el texto que tuvieron. Nada se
// escribe en la mensajería de la DEMO: los hilos van a `agente_sombra_hilos`
// (se leen en /sombra › Conversaciones) y a evals/hilos-tres/fixture.json.
//
//   npm run hilos:tres -- --estimar                    el tope de coste, sin gastar
//   npm run hilos:tres [-- --solo a,b] [--turnos N] [--decisores codigo,contexto,libre]
//   npm run hilos:tres -- --salida <ruta> --sin-db     pasada de MEDICIÓN: va a su
//                                                      propio fixture y no toca la
//                                                      base (ver el comentario de
//                                                      `rutaSalida`: rejugar encima
//                                                      corrompe el corpus de agenda)
//
// Coste (medido en hilos:jugar y sombra): paciente ≈ $0,013/turno · evaluador
// con juez ≈ $0,009 · sombra ≈ $0,003. A ≈ $0,022/turno; B y C ≈ $0,030 desde
// el 13-09 (su mensaje paga ahora su propio juez, y una reescritura cuando la
// frase que infringe era la respuesta). Es una ESTIMACIÓN para el `--estimar`:
// el coste real lo imprime el pase, y si se separa de esto hay que corregirlo.
// Salidas: 0 · 1 sin fixture o mal uso · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "kysely";
import { evaluarTurno, renderDatosQueConstan, SYSTEM_PROMPT_EVALUADOR, type EntradaEvaluador, type EvaluacionTurno } from "../app/lib/agente/evaluador";
import { CONOCIMIENTO_VACIO, parseConocimiento, type ConocimientoClinica } from "../app/lib/agente/conocimiento";
import { runWithClienteDb } from "../app/lib/db/context";
import { construirEntradaDePrueba, relojDelBanco, type EscenarioPrueba, type TurnoPrueba } from "../app/lib/agente/banco-pruebas";
import { avanzarSesion, SESION_NUEVA, type EstadoSesionPrueba } from "../app/lib/agente/sesion-prueba";
import { guardarHiloTres, pedirSombra, versionSombra } from "../app/lib/agente/sombra";
import { controlarMensajeDelDecisor } from "../app/lib/agente/control-decisor";
import { MODELO_JUEZ } from "../app/lib/agente/juez-borrador";
import { renderConocimiento } from "../app/lib/agente/conocimiento";
import { costeUsdDeTurno } from "../app/lib/agente/coste";
import { hashVersion } from "../app/lib/agente/version";
import { RUTA_FIXTURE, type FixtureHilos, type HiloJugado } from "../app/lib/agente/hilos-jugados";
import { agregarTardanza, DECISORES, type VarianteSombra, ETIQUETA_DECISOR, fraseControl, fraseTardanza, tardanzaDe, RUTA_FIXTURE_TRES, type Decisor, type FinTres, type FixtureTres, type HiloTres, type MensajeTres, type ResumenTres } from "../app/lib/agente/actos";
import { runWithCliente } from "../app/lib/cliente-contexto";
import { hoyISO } from "../app/lib/time";
import { pacienteDice, esFin, MODELO_PACIENTE, type Espejo } from "./hilos-jugados-paciente.mts";

const COSTE_TURNO: Record<Decisor, number> = { codigo: 0.022, contexto: 0.03, libre: 0.03, alcance: 0.03 };
/** Qué prompt de la sombra lleva cada decisor. El código no lleva ninguno. */
const VARIANTE_DE: Record<Exclude<Decisor, "codigo">, VarianteSombra> = {
  contexto: "produccion",
  libre: "libre",
  alcance: "alcance",
};

// ─── argumentos ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? "") : null;
};
const estimar = argv.includes("--estimar");
const solo = flag("--solo")?.split(",").filter(Boolean) ?? null;
const topeTurnos = flag("--turnos") ? Number(flag("--turnos")) : null;
const decisores = (flag("--decisores")?.split(",").filter(Boolean) ?? [...DECISORES]) as Decisor[];
if (decisores.some((d) => !(DECISORES as readonly string[]).includes(d))) {
  console.error(`✗ --decisores admite ${DECISORES.join(", ")}.`);
  process.exit(1);
}
// 14-09 (MEJORAS 237) — LA PASADA DE MEDICIÓN NO PUEDE PISAR EL CORPUS. El
// corpus de agenda saca 35 candidatos de `agente_sombra_hilos` (origen
// «guiones»), 11 de ellos en la vara, y su clave es `guion:<id>:<decisor>:<n>`:
// SIN EL TEXTO DENTRO. Rejugar un decisor reemplaza esas filas y las etiquetas
// que puso Simon a mano quedan colgando de mensajes que él nunca leyó — la vara
// del juez (28/32) se corrompería EN SILENCIO, que es la peor forma. Así que
// una pasada que solo sirve para medir el papel se escribe en SU fixture y no
// toca la base: `--salida <ruta> --sin-db`. (El arreglo de fondo —que la clave
// lleve el hash del texto, y rejugar cree candidatos nuevos en vez de heredar
// etiquetas— va en MEJORAS 239, no aquí.)
const rutaSalida = flag("--salida") ?? RUTA_FIXTURE_TRES;
const sinDb = argv.includes("--sin-db");
// 12-09: el conocimiento de cada clínica sale del fixture (el mundo del turno
// 1, jugado con las clínicas VACÍAS) o, con `--conocimiento db`, de lo que hay
// AHORA publicado en DEMO (npm run demo:conocimiento) — el caso real.
const conocimientoDe = (flag("--conocimiento") ?? "fixture") as "fixture" | "db";
if (conocimientoDe !== "fixture" && conocimientoDe !== "db") {
  console.error("✗ --conocimiento admite fixture | db.");
  process.exit(1);
}
if (!existsSync(RUTA_FIXTURE)) {
  console.error(`✗ No hay ${RUTA_FIXTURE}: el mundo de cada guion sale de su turno 1 (npm run hilos:jugar).`);
  process.exit(1);
}
const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
const hilosBase = (solo ? fixture.hilos.filter((h) => solo.includes(h.guion.id)) : fixture.hilos).filter((h) => h.turnos[0]?.entrada);
const maxDe = (h: HiloJugado) => Math.min(h.guion.maxTurnos, topeTurnos ?? 99);

const tope = hilosBase.reduce((s, h) => s + maxDe(h) * decisores.reduce((x, d) => x + COSTE_TURNO[d], 0), 0);
const tipico = hilosBase.reduce((s, h) => s + Math.min(3, maxDe(h)) * decisores.reduce((x, d) => x + COSTE_TURNO[d], 0), 0);
console.log(
  `Tres conversaciones por guion · ${hilosBase.length} guiones · decisores: ${decisores.join(", ")} · paciente ${MODELO_PACIENTE} · ` +
    `coste TOPE $${tope.toFixed(2)} (todos los hilos hasta maxTurnos) · típico ≈ $${tipico.toFixed(2)} (3 turnos por hilo)`,
);
if (estimar) process.exit(0);
for (const v of ["ANTHROPIC_API_KEY", "SUPABASE_DB_URL_APP"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v}.`);
    process.exit(2);
  }
}

// ─── el mundo del guion, desde el turno 1 del fixture ──────────────────────

function escenarioDe(b: EntradaEvaluador): EscenarioPrueba {
  const nombre = b.esPacienteConocido ? b.nombre : undefined;
  if (b.pendienteCobro > 0) return { tipo: "cobro", nombre, deuda: b.pendienteCobro };
  if (b.presupuestosVivos.length > 0) {
    const p = b.presupuestosVivos[0]!;
    return { tipo: "presupuesto", nombre, tratamiento: p.tratamiento ?? undefined, importe: p.importe ?? undefined };
  }
  return b.esPacienteConocido ? { tipo: "al_dia", nombre } : { tipo: "lead_nuevo" };
}

/** La entrada del turno: la sesión, el hilo y las señales las pone el
 *  constructor del banco (la misma construcción que producción); el MUNDO
 *  (quién es, qué tiene, qué está publicado, qué objetivos) es el que vio el
 *  evaluador en el turno 1 del fixture. */
function entradaDelTurno(args: {
  base: EntradaEvaluador;
  hilo: TurnoPrueba[];
  mensaje: string;
  sesion: EstadoSesionPrueba;
  hoy: string;
  noLegible: { tipo: string; etiqueta: string } | null;
}): EntradaEvaluador {
  const b = args.base;
  const e = construirEntradaDePrueba({
    escenario: escenarioDe(b),
    hilo: args.hilo,
    mensaje: args.mensaje,
    conocimiento: b.conocimiento ?? null,
    objetivosConfig: b.objetivosAbiertos,
    clinicaNombre: b.clinica ?? null,
    sesion: args.sesion,
    hoy: args.hoy,
  });
  return {
    ...e,
    nombre: b.nombre,
    nombrePerfil: b.nombrePerfil ?? null,
    esPacienteConocido: b.esPacienteConocido,
    clinica: b.clinica ?? null,
    objetivosAbiertos: b.objetivosAbiertos,
    presupuestosVivos: b.presupuestosVivos,
    pendienteCobro: b.pendienteCobro,
    umbralInsistencia: b.umbralInsistencia,
    urgencias: b.urgencias,
    diasHastaProximaCita: b.diasHastaProximaCita ?? null,
    umbralCitaProximaDias: b.umbralCitaProximaDias,
    identidadAmbigua: b.identidadAmbigua ?? null,
    clinicasDelHilo: b.clinicasDelHilo ?? null,
    ultimoNoLegible: args.noLegible,
  };
}

// ─── un hilo, un decisor ───────────────────────────────────────────────────

const ETIQUETA_HECHO: Record<string, string> = { urgencia: "urgencia", peticion_queja: "queja o petición de persona", no_legible: "mensaje no legible" };

type Estado = {
  hilo: TurnoPrueba[];
  espejo: Espejo[];
  sesion: EstadoSesionPrueba;
  mensajes: MensajeTres[];
  usd: number;
  turnos: number;
  derivoEn: number | null;
  motivo: string | null;
  causa: string | null;
  porHecho: boolean;
  /** Primer turno con el objetivo cubierto (entrega tardía, 13-09). */
  pudoEn: number | null;
  datos: Record<string, string>;
  aplazados: Set<string>;
  repeticiones: number;
  molestiaEn: number | null;
  /** Descartes SEGUIDOS del control (233): al segundo, el caso pasa a una persona. */
  descartesSeguidos: number;
  control: { podados: number; reescritos: number; descartados: number };
  fin: FinTres;
  detalleFin: string | null;
};

function aplanar(campos: EvaluacionTurno["camposRecogidos"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [etapa, cs] of Object.entries(campos ?? {})) {
    for (const [k, v] of Object.entries(cs ?? {})) {
      if (typeof v === "string" && v.trim() && v !== "no_aplica") out[`${etapa}.${k}`] = v.trim();
    }
  }
  return out;
}

/** Lo publicado AHORA por la clínica del guion, con el parser REAL (el mismo
 *  que `conocimientoDeClinica`). Por NOMBRE porque el fixture no lleva el id:
 *  es configuración de demo, no identidad de una persona (§20). */
async function conocimientoPublicadoDe(clinicaNombre: string | null): Promise<ConocimientoClinica> {
  if (!clinicaNombre) throw new Error("el guion no lleva clínica: no se puede leer su conocimiento");
  return runWithCliente("DEMO", () =>
    runWithClienteDb("DEMO", async (trx) => {
      const r: any = await sql`select ca.conocimiento
          from configuracion_automatizaciones ca
          join clinicas c on c.id = ca.clinica_id and c.cliente = ca.cliente
         where c.nombre = ${clinicaNombre}
         limit 1`.execute(trx);
      if (!r.rows?.[0]) throw new Error(`sin configuración para «${clinicaNombre}» en DEMO (npm run demo:reset)`);
      return parseConocimiento(r.rows[0].conocimiento ?? null);
    }),
  );
}

async function jugarHilo(h: HiloJugado, decisor: Decisor, hoy: string): Promise<HiloTres> {
  // 12-09: `--conocimiento db` juega con LO PUBLICADO ahora por esa clínica
  // (el caso real); por defecto, el mundo del turno 1 del fixture.
  // 13-09: el conocimiento del fixture se guardó el 10-09, ANTES de que
  // existiera `ubicacion` (dirección · cómo llegar · parking, 12-09), y
  // `esConocimientoVacio` lee `c.ubicacion.direccion`: usarlo tal cual
  // reventaba los cuatro guiones en el modo por defecto. Se completa con
  // CONOCIMIENTO_VACIO — que es lo que este modo significa— en vez de
  // confiar en que un artefacto viejo tenga la forma de hoy.
  const base: EntradaEvaluador =
    conocimientoDe === "db"
      ? { ...h.turnos[0]!.entrada!, conocimiento: await conocimientoPublicadoDe(h.turnos[0]!.entrada!.clinica ?? null) }
      : { ...h.turnos[0]!.entrada!, conocimiento: { ...CONOCIMIENTO_VACIO, ...(h.turnos[0]!.entrada!.conocimiento ?? {}) } };
  const g = h.guion;
  const maxTurnos = maxDe(h);
  // El arranque común: lo que la clínica escribió antes (cadencia, recordatorio)
  // y el PRIMER mensaje del paciente, los mismos en los tres hilos.
  const primerEntrante = h.mensajes.find((m) => m.direccion === "Entrante")!;
  const cadencias = h.mensajes.filter((m) => m.direccion === "Saliente" && m.fuente === "Plantilla_automatica");
  let cadenciasUsadas = 0;
  const st: Estado = {
    hilo: [],
    espejo: [],
    sesion: SESION_NUEVA,
    mensajes: [],
    usd: 0,
    turnos: 0,
    derivoEn: null,
    motivo: null,
    causa: null,
    porHecho: false,
    pudoEn: null,
    datos: {},
    aplazados: new Set(),
    repeticiones: 0,
    molestiaEn: null,
    descartesSeguidos: 0,
    control: { podados: 0, reescritos: 0, descartados: 0 },
    fin: "perdido",
    detalleFin: "se agotaron los turnos",
  };
  const publicado = renderConocimiento(base.conocimiento).join("\n");
  console.log(`\n  ── ${decisor} · conocimiento (${conocimientoDe}): ${publicado ? `${publicado.split("\n").length} líneas publicadas` : "clínica vacía"}`);

  for (let n = 1; n <= maxTurnos; n++) {
    // Cadencias del guion antes de este turno (en el turno 1 ya vienen en el hilo base).
    for (const paso of g.pasos ?? []) {
      if (paso.antesDelTurno !== n || paso.tipo === "entrante_no_legible" || n === 1) continue;
      const c = cadencias[cadenciasUsadas++];
      if (!c) continue;
      st.hilo.push({ direccion: "Saliente", contenido: c.contenido });
      st.espejo.push({ direccion: "Saliente", contenido: c.contenido, quien: "cadencia" });
      st.mensajes.push({ n, quien: "cadencia", texto: c.contenido });
      console.log(`  ⤵ cadencia: «${c.contenido.slice(0, 60)}…»`);
    }
    if (n === 1) {
      // Los salientes previos al primer entrante (recordatorio, cadencia) del hilo base.
      for (const m of base.hilo) {
        if (m.direccion === "Entrante") break;
        st.hilo.push({ direccion: "Saliente", contenido: m.contenido });
        st.espejo.push({ direccion: "Saliente", contenido: m.contenido, quien: "cadencia" });
        st.mensajes.push({ n: 0, quien: "cadencia", texto: m.contenido });
      }
    }

    // El entrante: el primero es el del fixture (mismo arranque); después, el paciente reacciona a ESTE decisor.
    let entrante: string;
    let noLegible: { tipo: string; etiqueta: string } | null = null;
    if (n === 1) {
      entrante = primerEntrante.contenido;
      if (primerEntrante.tipo && primerEntrante.tipo !== "text") noLegible = { tipo: primerEntrante.tipo, etiqueta: primerEntrante.contenido };
    } else {
      const p = await pacienteDice(g, st.espejo);
      st.usd += costeUsdDeTurno(p.usage, MODELO_PACIENTE) ?? 0;
      // §9 — el paciente mudo NO es un paciente que se fue. Si el modelo
      // devuelve vacío (refusal, corte por max_tokens, bloque sin texto), el
      // hilo seguiría con un entrante «» y el evaluador juzgaría la nada: un
      // fallo del instrumento con cara de conversación corta.
      if (!p.texto.trim()) throw new Error(`el paciente no dijo nada en el turno ${n}: no hay medida que guardar`);
      if (esFin(p.texto)) {
        st.fin = "resuelto";
        st.detalleFin = "el paciente dio por resuelto lo suyo";
        console.log(`  t${n} ■ paciente: FIN`);
        break;
      }
      entrante = p.texto;
    }
    st.turnos = n;
    st.mensajes.push({ n, quien: "paciente", texto: entrante, noLegible: noLegible != null });
    st.espejo.push({ direccion: "Entrante", contenido: entrante, quien: "paciente" });

    const entrada = entradaDelTurno({ base, hilo: st.hilo, mensaje: entrante, sesion: st.sesion, hoy, noLegible });
    const ev = await evaluarTurno(entrada);
    st.usd += costeUsdDeTurno(ev.usage, ev.modelo) ?? 0;
    if (ev.fallback) {
      // §4 + §9 — UN FALLO DEL INSTRUMENTO NO ES UNA MEDIDA, y este tiene la
      // cara exacta de lo que medimos («perdido · nunca llegó a tener todo lo
      // que pide el objetivo»). Se LANZA: así el hilo no se escribe ni en el
      // fixture ni en el visor —donde pisaría por upsert el hilo bueno de la
      // pasada anterior— y el pase cuenta el fallo y sale distinto de 0. El
      // 13-09 el crédito de la API se acabó a mitad de una pasada y los hilos
      // muertos salieron como 1/4 «con el objetivo cubierto».
      throw new Error(`el evaluador no respondió en el turno ${n} (fallback): no hay medida que guardar`);
    }

    // Hechos del turno (los mismos para los tres): repetición, molestia, datos, anotado.
    if (ev.juicios?.vuelveSobreAplazado) st.repeticiones++;
    if (ev.juicios?.malestar && st.molestiaEn == null) st.molestiaEn = n;
    Object.assign(st.datos, aplanar(ev.camposRecogidos));
    for (const a of ev.aplazamientos) st.aplazados.add(a.clave);
    // ENTREGA TARDÍA: el turno en que el caso YA se podía entregar. Es del
    // evaluador —que corre en los tres decisores—, no del que redacta: por eso
    // compara los tres contra el mismo contrato. El código entrega aquí mismo
    // salvo que otra regla gane; el modelo puede seguir preguntando.
    if (ev.casoCompleto && st.pudoEn == null) st.pudoEn = n;
    const hecho = ev.sinJuicio ? "no_legible" : ev.juicios?.urgenciaMedica ? "urgencia" : ev.juicios?.peticionOQueja ? "peticion_queja" : null;

    // El decisor.
    let texto: string;
    let acto: MensajeTres["acto"] = ev.acto ?? null;
    let veto: string | null = null;
    let borrador: string | null = null;
    let control: MensajeTres["control"] = null;
    let deriva: boolean;
    let motivo: string | null = null;
    let causa: string | null = null;
    let porHecho = false;
    if (decisor === "codigo") {
      texto = ev.respuesta ?? "";
      deriva = ev.decision === "deriva";
      causa = deriva ? (ev.causa ?? null) : null;
      motivo = deriva ? `${ev.causa ?? "caso completo"}${ev.motivoDerivacion ? ` · ${ev.motivoDerivacion}` : ""}` : null;
      porHecho = deriva && (ev.causa === "urgencia" || ev.causa === "peticion_queja" || ev.causa === "no_legible");
      veto = ev.borradorDescartado ? `borrador descartado (${ev.borradorDescartado.motivo})` : null;
      // El control de A viene por su propia vía (evaluarTurno ya lo corrió):
      // se traduce a la MISMA forma que B y C para que los contadores cuenten
      // lo mismo en los tres. Su borrador original no vuelve del evaluador,
      // así que aquí es null: lo que hay es el veredicto, no el texto previo.
      const reescritoA = ev.etiquetasDescartadas.some((t) => t.startsWith("juez:reescrito:"));
      if (ev.borradorDescartado) {
        control = { estado: ev.borradorDescartado.motivo === "juez_no_respondio" ? "juez_no_respondio" : "descartado", motivo: ev.borradorDescartado.motivo, frase: ev.borradorDescartado.frase, reescrito: ev.borradorDescartado.reescrito ?? false };
        st.control.descartados++;
      } else if (ev.borradorPodado) {
        control = { estado: "podado", motivo: ev.borradorPodado.motivo, frase: ev.borradorPodado.frase, reescrito: reescritoA };
        st.control.podados++;
      } else if (reescritoA) {
        control = { estado: "reescrito", motivo: null, frase: null, reescrito: true };
        st.control.reescritos++;
      }
    } else {
      // El OBJETIVO que se le presta al decisor «alcance»: el caso abierto que
      // el evaluador ya decidió este turno, en una frase y SIN sus campos. Es
      // estado del sistema (qué caso hay delante), no la lista de campos con
      // otro nombre — pero es una asimetría con el libre y se dice al leer la
      // comparación.
      const defObjetivo = ev.objetivoActivo ? entrada.objetivosAbiertos.find((o) => o.etapa === ev.objetivoActivo) : null;
      const opts = {
        variante: VARIANTE_DE[decisor],
        objetivo: defObjetivo ? { etapa: defObjetivo.etapa, proposito: defObjetivo.proposito } : null,
        // §9 — «no pude preguntar» (sin clave, 4xx, timeout) LANZA y el hilo no
        // se guarda. «Contestó algo inservible» devuelve null y, tras el
        // reintento, LANZA TAMBIÉN (14-09): ver abajo.
        estricto: true,
      };
      let s = ev.sinJuicio ? null : await pedirSombra(entrada, opts);
      if (!s && !ev.sinJuicio) {
        await new Promise((r) => setTimeout(r, 2000));
        s = await pedirSombra(entrada, opts);
      }
      if (!s) {
        if (hecho === "no_legible") {
          texto = "";
          acto = "atender";
        } else {
          // §9, y es el mismo agujero que los timeouts (14-09, pedido de
          // Simon): esto TERMINABA el hilo con `perdido · el decisor no
          // respondió`, que es la cara exacta de lo que medimos —un agente que
          // pierde a la persona— y entraba en el denominador como si fuera una
          // conversación. El 14-09 `telefono_compartido/libre` se cortó así en
          // el turno 5 y contó como uno de los cuatro hilos de la tabla. Que el
          // modelo conteste JSON ilegible DOS VECES es un fallo del
          // instrumento, no una decisión suya: se lanza, el hilo no se guarda y
          // el pase sale distinto de 0.
          throw new Error(`el decisor no respondió nada usable en el turno ${n} (dos intentos): no hay medida que guardar`);
        }
      } else {
        st.usd += costeUsdDeTurno(s.usage, s.modelo) ?? 0;
        texto = s.mensaje;
        acto = s.acto;
      }
      const porActo = acto === "atender" || acto === "cerrar";

      // EL CONTROL, la misma secuencia que producción (13-09). Sobre los
      // MISMOS datos que constan que ve el juez del código, y con el MISMO
      // modelo que escribió el mensaje para la reescritura.
      let pasaAPersona = false;
      if (texto.trim() !== "") {
        const perdonados: string[] = [];
        const m = await controlarMensajeDelDecisor({
          mensaje: texto,
          nombre: st.datos["cita.nombre_completo"] ?? st.datos["identificar.nombre"] ?? (base.esPacienteConocido ? base.nombre : ""),
          datosQueConstan: renderDatosQueConstan(entrada),
          ultimoMensaje: entrante,
          dichoPorLaPersona: st.hilo.filter((t) => t.direccion === "Entrante").map((t) => t.contenido).concat(entrante).join(" · ").slice(-1500),
          // Este turno ENTREGA si el decisor lo pasa a una persona, si lo
          // fuerza un hecho o si queda algo anotado que alguien va a ver:
          // sin esto, la regla de la promesa juzga contra otro turno.
          turnoEntrega: porActo || hecho != null || ev.aplazamientos.length > 0 || ev.casoCompleto === true,
          citaConsta: entrada.diasHastaProximaCita != null,
          idioma: ev.idioma ?? "es",
          modeloId: s?.modelo,
          descartesSeguidosAntes: st.descartesSeguidos,
          perdonados,
        });
        // Tarifado al modelo del JUEZ, que es quien pone casi todos los
        // tokens del control (la reescritura, cuando ocurre, va con el mismo
        // haiku que escribió el mensaje).
        st.usd += costeUsdDeTurno(m.usage, MODELO_JUEZ) ?? 0;
        if (m.control) {
          borrador = m.borrador;
          control = m.control;
          texto = m.texto;
          veto = m.nota;
          if (m.control.estado === "podado") st.control.podados++;
          else if (m.control.estado === "reescrito") st.control.reescritos++;
          else st.control.descartados++;
        }
        st.descartesSeguidos = m.descartesSeguidos;
        pasaAPersona = m.pasaAPersona;
        for (const p of perdonados) console.log(`      (juez perdonó un falso positivo: ${p})`);
      } else {
        // Sin borrador no hay descarte: la racha se corta, como en producción.
        st.descartesSeguidos = 0;
      }

      porHecho = hecho != null && !porActo;
      // MEJORAS 233 — dos descartes seguidos son un callejón: el caso pasa a
      // una persona aunque el decisor no lo hubiera decidido. Va el último en
      // precedencia, como en producción: si el turno ya entregaba por queja o
      // urgencia, esa causa dice más.
      deriva = porActo || hecho != null || pasaAPersona;
      causa = deriva ? (hecho ?? (acto === "cerrar" ? "caso_completo" : porActo ? "peticion_queja" : "sin_respuesta_valida")) : null;
      motivo = deriva
        ? porHecho
          ? `por hecho: ${ETIQUETA_HECHO[hecho!] ?? hecho}`
          : !porActo && pasaAPersona
            ? "dos descartes seguidos del control"
            : `${acto}${s?.porQue ? ` · ${s.porQue}` : s?.conviene ? ` · ${s.conviene}` : ""}`
        : null;
    }

    st.mensajes.push({ n, quien: "agente", texto, acto, veto, borrador, control, deriva, motivo });
    st.hilo.push({ direccion: "Entrante", contenido: entrante });
    if (texto) {
      st.hilo.push({ direccion: "Saliente", contenido: texto });
      st.espejo.push({ direccion: "Saliente", contenido: texto, quien: "agente" });
    }
    console.log(`  t${n} paciente: «${entrante.slice(0, 70)}»`);
    console.log(`  t${n} ${decisor} [${acto ?? "—"}${deriva ? " · PASA A UNA PERSONA" : ""}]: «${texto.slice(0, 90)}»${veto ? `  ⚠ ${veto}` : ""}`);

    // La sesión avanza como si producción hubiera persistido lo que ESTE decisor decidió.
    st.sesion = avanzarSesion(
      st.sesion,
      { ...ev, decision: deriva ? "deriva" : "sigue", causa: causa ?? undefined },
      { instante: relojDelBanco(hoy, st.hilo.length), entrante },
    );
    if (deriva) {
      st.derivoEn = n;
      st.motivo = motivo;
      st.causa = causa;
      st.porHecho = porHecho;
      st.fin = "derivado";
      st.detalleFin = null;
      break;
    }
    if (ev.pideNoContacto) {
      st.fin = "perdido";
      st.detalleFin = "pidió no recibir más mensajes";
      break;
    }
  }

  const resumen: ResumenTres = {
    turnos: st.turnos,
    derivoEn: st.derivoEn,
    motivo: st.motivo,
    causa: st.causa,
    porHecho: st.porHecho,
    pudoEn: st.pudoEn,
    datos: Object.entries(st.datos).map(([k, v]) => `${k}: ${v}`),
    aplazados: [...st.aplazados],
    repeticiones: st.repeticiones,
    molestiaEn: st.molestiaEn,
    control: st.control,
    fin: st.fin,
    detalleFin: st.detalleFin,
    costeUsd: Math.round(st.usd * 10_000) / 10_000,
  };
  console.log(
    `  ▸ ${decisor}: ${resumen.fin}${resumen.derivoEn ? ` en ${resumen.derivoEn} mensaje${resumen.derivoEn === 1 ? "" : "s"} (${resumen.motivo})` : ""} · repitió ${resumen.repeticiones} · molestia ${resumen.molestiaEn ?? "no"} · datos ${resumen.datos.length} · $${resumen.costeUsd.toFixed(3)}`,
  );
  console.log(`    ${fraseControl(resumen)}`);
  console.log(`    ${fraseTardanza(tardanzaDe(resumen))}`);
  const version = decisor === "codigo" ? hashVersion(SYSTEM_PROMPT_EVALUADOR) : versionSombra(VARIANTE_DE[decisor]);
  return { guionId: g.id, titulo: g.titulo, categoria: g.categoria, decisor, version, jugadoEl: new Date().toISOString(), mensajes: st.mensajes, resumen, costeUsd: resumen.costeUsd, conocimientoDe };
}

// ─── el pase ───────────────────────────────────────────────────────────────

const previo: FixtureTres | null = existsSync(rutaSalida) ? (JSON.parse(readFileSync(rutaSalida, "utf8")) as FixtureTres) : null;
const salida: FixtureTres = previo ?? { v: 1, jugadoEl: new Date().toISOString(), modeloPaciente: MODELO_PACIENTE, hilos: [] };
const hoy = hoyISO();
let usdTotal = 0;
// Solo lo jugado EN ESTE PASE: el fixture arrastra hilos de pases anteriores
// (sin la métrica) y mezclarlos daría un denominador que no es de nadie.
const jugados = Object.fromEntries(DECISORES.map((d) => [d, [] as HiloTres[]])) as Record<Decisor, HiloTres[]>;
// §9: «no pude jugar» y «jugué» no pueden salir con el mismo código. El 13-09
// los cuatro guiones petaron en el modo por defecto y el pase terminó con
// «coste medido $0.00» y salida 0 — un fallo total con cara de pase vacío.
let fallos = 0;
const caidos: string[] = [];

for (const h of hilosBase) {
  console.log("\n" + "═".repeat(72) + `\n▶ ${h.guion.id} · ${h.guion.titulo}`);
  const entradaGuion = salida.hilos.find((x) => x.guion.id === h.guion.id) ?? { guion: { id: h.guion.id, titulo: h.guion.titulo, categoria: h.guion.categoria }, decisores: {} };
  for (const d of decisores) {
    try {
      const hilo = await jugarHilo(h, d, hoy);
      usdTotal += hilo.costeUsd;
      jugados[d].push(hilo);
      entradaGuion.decisores[d] = hilo;
      if (!sinDb) await runWithCliente("DEMO", () => guardarHiloTres(hilo));
    } catch (err) {
      fallos++;
      caidos.push(`${h.guion.id}/${d}: ${err instanceof Error ? err.message : String(err)}`);
      // Y NO SE DEJA EL DE LA PASADA ANTERIOR EN SU SITIO. El fixture se
      // reabre y se reescribe encima: si el hilo de hoy no se jugó, el de ayer
      // seguiría ahí con su fecha vieja y el juicio lo contaría como parte de
      // esta pasada (es lo que hay en `fixture.json`: hilos de las 11:51
      // mezclados con los de las 22:00). Un hueco se ve; un dato caducado que
      // ocupa el hueco, no.
      delete entradaGuion.decisores[d];
      console.error(`  ✗ ${h.guion.id}/${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!salida.hilos.some((x) => x.guion.id === h.guion.id)) salida.hilos.push(entradaGuion);
  salida.jugadoEl = new Date().toISOString();
  mkdirSync(dirname(rutaSalida), { recursive: true });
  writeFileSync(rutaSalida, JSON.stringify(salida, null, 1));
}

// §9 — UNA TABLA CON AGUJEROS NO SE PINTA COMO UNA TABLA. Va ANTES que las
// cifras, no después: el que lee decide con lo primero que ve. Mismo aviso que
// `juicio-sobre-hilos.mts` cuando falta un juicio.
const intentados = hilosBase.length * decisores.length;
if (fallos > 0) {
  console.log("\n" + "!".repeat(78));
  console.log(`✗ ${fallos} de ${intentados} HILOS NO SE JUGARON — el instrumento falló, no el agente:`);
  for (const c of caidos) console.log(`    · ${c}`);
  console.log("  LAS CIFRAS DE ABAJO NO VALEN: describen menos conversaciones de las que dicen,");
  console.log("  y el fixture está incompleto (esos hilos no están: ni el nuevo ni el viejo).");
  console.log("  Vuelve a lanzarlo. NO lo juzgues con `agenda:juicio:hilos`.");
  console.log("!".repeat(78));
}
// Los hilos que siguen en el fichero de salida SIN haberse jugado hoy (`--solo`,
// otro juego de decisores, un pase anterior sobre el mismo fichero). No son un
// fallo, pero el juicio los lee como si fueran de esta pasada.
const jugadosHoy = new Set(DECISORES.flatMap((d) => jugados[d].map((h) => `${h.guionId}/${d}`)));
const arrastrados = salida.hilos.flatMap((h) => Object.keys(h.decisores).map((d) => `${h.guion.id}/${d}`)).filter((k) => !jugadosHoy.has(k));
if (arrastrados.length > 0) {
  console.log(`\n⚠ ${rutaSalida} arrastra ${arrastrados.length} hilo(s) de pases ANTERIORES: ${arrastrados.join(", ")}.`);
  console.log("  El juicio los contará como parte de esta pasada. Usa --salida con un fichero nuevo si no los quieres.");
}

console.log("\n" + "═".repeat(72));
console.log("ENTREGA TARDÍA — mensajes que el paciente siguió contestando con el caso ya listo:");
for (const d of decisores) {
  const a = agregarTardanza(jugados[d]);
  if (a.hilos === 0) continue;
  const media = a.tarde > 0 ? ` (${(a.turnosDeMas / a.tarde).toFixed(1)} de media)` : "";
  console.log(
    `  ${ETIQUETA_DECISOR[d]}: ${a.medidos}/${a.hilos} con el objetivo cubierto · a tiempo ${a.aTiempo} · tarde ${a.tarde} (+${a.turnosDeMas}${media})` +
      ` · se pudo y no entregó ${a.nunca}${a.nunca ? ` (+${a.turnosDeMasNunca})` : ""} · sin cubrirlo ${a.sinContrato}` +
      `${a.incoherentes ? ` · INCOHERENTES ${a.incoherentes}` : ""}` +
      `${a.hilos < hilosBase.length ? `  ⚠ de ${hilosBase.length} intentados` : ""}`,
  );
  // UN HILO DE UN SOLO MENSAJE NO SE LEE COMO UNA CONVERSACIÓN (14-09). Es
  // legítimo —entregar en el primer mensaje por una queja o una urgencia lo
  // es— pero el objetivo NUNCA pudo cubrirse ahí, así que baja la fracción de
  // arriba por una razón que no tiene nada que ver con recoger mal. Se dice al
  // lado del número, no en el detalle de más abajo.
  const cortos = jugados[d].filter((h) => h.resumen.turnos <= 1);
  for (const h of cortos) {
    console.log(`      ⚠ ${h.guionId}: murió en el mensaje 1 (${h.resumen.fin}${h.resumen.causa ? ` · ${h.resumen.causa}` : ""}) — cuenta en el denominador y no pudo cubrir nada`);
  }
}
console.log("═".repeat(72));
console.log(
  `${hilosBase.length} guiones × ${decisores.length} decisores · coste medido $${usdTotal.toFixed(2)} · fixture ${rutaSalida}` +
    (sinDb ? " · --sin-db: la base NO se ha tocado (el corpus de agenda sigue apuntando a los mensajes que etiquetó Simon)" : " · léelo en /sombra › Conversaciones"),
);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
if (fallos > 0) {
  console.error(`\n✗ ${fallos} hilo(s) NO se jugaron: lo de arriba no es un pase completo.`);
  process.exit(1);
}
