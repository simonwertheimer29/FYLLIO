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
// En B y C el evaluador corre igualmente cada turno: aporta los HECHOS
// (urgencia, queja, lo anotado, lo recogido) y hace avanzar la sesión como
// producción; pero el mensaje y la decisión de pasar el caso son del decisor
// (acto «atender» o «cerrar» = pasa a una persona y para). Las entregas
// obligatorias por hechos no se tocan: con urgencia, queja o mensaje no
// legible el hilo pasa a una persona en ese turno lo diga el decisor o no
// (se anota «por hecho»). Los mensajes de B y C no pasan por el juez: se les
// pasan los vetos deterministas solo para ENSEÑAR si los cazarían.
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
//
// Coste (medido en hilos:jugar y sombra): paciente ≈ $0,013/turno · evaluador
// con juez ≈ $0,009 · sombra ≈ $0,003. A ≈ $0,022/turno; B y C ≈ $0,025.
// Salidas: 0 · 1 sin fixture o mal uso · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "kysely";
import { evaluarTurno, SYSTEM_PROMPT_EVALUADOR, type EntradaEvaluador, type EvaluacionTurno } from "../app/lib/agente/evaluador";
import { parseConocimiento, type ConocimientoClinica } from "../app/lib/agente/conocimiento";
import { runWithClienteDb } from "../app/lib/db/context";
import { construirEntradaDePrueba, relojDelBanco, type EscenarioPrueba, type TurnoPrueba } from "../app/lib/agente/banco-pruebas";
import { avanzarSesion, SESION_NUEVA, type EstadoSesionPrueba } from "../app/lib/agente/sesion-prueba";
import { guardarHiloTres, pedirSombra, versionSombra } from "../app/lib/agente/sombra";
import { vetoAgendaDeterminista, vetoServicioDeterminista } from "../app/lib/agente/juez-borrador";
import { renderConocimiento } from "../app/lib/agente/conocimiento";
import { costeUsdDeTurno } from "../app/lib/agente/coste";
import { hashVersion } from "../app/lib/agente/version";
import { RUTA_FIXTURE, type FixtureHilos, type HiloJugado } from "../app/lib/agente/hilos-jugados";
import { DECISORES, type Decisor, type FinTres, type HiloTres, type MensajeTres, type ResumenTres } from "../app/lib/agente/actos";
import { runWithCliente } from "../app/lib/cliente-contexto";
import { hoyISO } from "../app/lib/time";
import { pacienteDice, esFin, MODELO_PACIENTE, type Espejo } from "./hilos-jugados-paciente.mts";

export const RUTA_FIXTURE_TRES = "evals/hilos-tres/fixture.json";
const COSTE_TURNO: Record<Decisor, number> = { codigo: 0.022, contexto: 0.025, libre: 0.025 };

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
  datos: Record<string, string>;
  aplazados: Set<string>;
  repeticiones: number;
  molestiaEn: number | null;
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
  const base: EntradaEvaluador =
    conocimientoDe === "db"
      ? { ...h.turnos[0]!.entrada!, conocimiento: await conocimientoPublicadoDe(h.turnos[0]!.entrada!.clinica ?? null) }
      : h.turnos[0]!.entrada!;
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
    datos: {},
    aplazados: new Set(),
    repeticiones: 0,
    molestiaEn: null,
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
      st.fin = "perdido";
      st.detalleFin = "el evaluador no respondió";
      st.mensajes.push({ n, quien: "agente", texto: "", deriva: false, motivo: "fallo del evaluador" });
      break;
    }

    // Hechos del turno (los mismos para los tres): repetición, molestia, datos, anotado.
    if (ev.juicios?.vuelveSobreAplazado) st.repeticiones++;
    if (ev.juicios?.malestar && st.molestiaEn == null) st.molestiaEn = n;
    Object.assign(st.datos, aplanar(ev.camposRecogidos));
    for (const a of ev.aplazamientos) st.aplazados.add(a.clave);
    const hecho = ev.sinJuicio ? "no_legible" : ev.juicios?.urgenciaMedica ? "urgencia" : ev.juicios?.peticionOQueja ? "peticion_queja" : null;

    // El decisor.
    let texto: string;
    let acto: MensajeTres["acto"] = ev.acto ?? null;
    let veto: string | null = null;
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
    } else {
      let s = ev.sinJuicio ? null : await pedirSombra(entrada, { variante: decisor === "contexto" ? "produccion" : "libre" });
      if (!s && !ev.sinJuicio) {
        await new Promise((r) => setTimeout(r, 2000));
        s = await pedirSombra(entrada, { variante: decisor === "contexto" ? "produccion" : "libre" });
      }
      if (!s) {
        if (hecho === "no_legible") {
          texto = "";
          acto = "atender";
        } else {
          st.fin = "perdido";
          st.detalleFin = "el decisor no respondió";
          st.mensajes.push({ n, quien: "agente", texto: "", deriva: false, motivo: "el decisor no respondió" });
          break;
        }
      } else {
        st.usd += costeUsdDeTurno(s.usage, s.modelo) ?? 0;
        texto = s.mensaje;
        acto = s.acto;
        veto = vetoAgendaDeterminista(texto) ?? vetoServicioDeterminista(texto, publicado);
      }
      const porActo = acto === "atender" || acto === "cerrar";
      porHecho = hecho != null && !porActo;
      deriva = porActo || hecho != null;
      causa = deriva ? (hecho ?? (acto === "cerrar" ? "caso_completo" : "peticion_queja")) : null;
      motivo = deriva
        ? porHecho
          ? `por hecho: ${ETIQUETA_HECHO[hecho!] ?? hecho}`
          : `${acto}${s?.porQue ? ` · ${s.porQue}` : s?.conviene ? ` · ${s.conviene}` : ""}`
        : null;
    }

    st.mensajes.push({ n, quien: "agente", texto, acto, veto, deriva, motivo });
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
    datos: Object.entries(st.datos).map(([k, v]) => `${k}: ${v}`),
    aplazados: [...st.aplazados],
    repeticiones: st.repeticiones,
    molestiaEn: st.molestiaEn,
    fin: st.fin,
    detalleFin: st.detalleFin,
    costeUsd: Math.round(st.usd * 10_000) / 10_000,
  };
  console.log(
    `  ▸ ${decisor}: ${resumen.fin}${resumen.derivoEn ? ` en ${resumen.derivoEn} mensaje${resumen.derivoEn === 1 ? "" : "s"} (${resumen.motivo})` : ""} · repitió ${resumen.repeticiones} · molestia ${resumen.molestiaEn ?? "no"} · datos ${resumen.datos.length} · $${resumen.costeUsd.toFixed(3)}`,
  );
  const version = decisor === "codigo" ? hashVersion(SYSTEM_PROMPT_EVALUADOR) : versionSombra(decisor === "contexto" ? "produccion" : "libre");
  return { guionId: g.id, titulo: g.titulo, categoria: g.categoria, decisor, version, jugadoEl: new Date().toISOString(), mensajes: st.mensajes, resumen, costeUsd: resumen.costeUsd, conocimientoDe };
}

// ─── el pase ───────────────────────────────────────────────────────────────

type FixtureTres = { v: 1; jugadoEl: string; modeloPaciente: string; hilos: { guion: { id: string; titulo: string; categoria: string }; decisores: Partial<Record<Decisor, HiloTres>> }[] };
const previo: FixtureTres | null = existsSync(RUTA_FIXTURE_TRES) ? (JSON.parse(readFileSync(RUTA_FIXTURE_TRES, "utf8")) as FixtureTres) : null;
const salida: FixtureTres = previo ?? { v: 1, jugadoEl: new Date().toISOString(), modeloPaciente: MODELO_PACIENTE, hilos: [] };
const hoy = hoyISO();
let usdTotal = 0;

for (const h of hilosBase) {
  console.log("\n" + "═".repeat(72) + `\n▶ ${h.guion.id} · ${h.guion.titulo}`);
  const entradaGuion = salida.hilos.find((x) => x.guion.id === h.guion.id) ?? { guion: { id: h.guion.id, titulo: h.guion.titulo, categoria: h.guion.categoria }, decisores: {} };
  for (const d of decisores) {
    try {
      const hilo = await jugarHilo(h, d, hoy);
      usdTotal += hilo.costeUsd;
      entradaGuion.decisores[d] = hilo;
      await runWithCliente("DEMO", () => guardarHiloTres(hilo));
    } catch (err) {
      console.error(`  ✗ ${h.guion.id}/${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!salida.hilos.some((x) => x.guion.id === h.guion.id)) salida.hilos.push(entradaGuion);
  salida.jugadoEl = new Date().toISOString();
  mkdirSync(dirname(RUTA_FIXTURE_TRES), { recursive: true });
  writeFileSync(RUTA_FIXTURE_TRES, JSON.stringify(salida, null, 1));
}

console.log("\n" + "═".repeat(72));
console.log(`${hilosBase.length} guiones × ${decisores.length} decisores · coste medido $${usdTotal.toFixed(2)} · fixture ${RUTA_FIXTURE_TRES} · léelo en /sombra › Conversaciones`);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
