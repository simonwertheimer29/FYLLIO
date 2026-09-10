#!/usr/bin/env tsx
// scripts/jugar-hilos.mts — JUGAR los hilos (10-09).
//
// Un modelo hace de PACIENTE (perfil + objetivo del guion) y el agente REAL
// contesta turno a turno por el MISMO camino que el webhook (demo-entrante):
// `recibirMensaje` persiste el entrante y `evaluarEntranteConversacion`
// evalúa, persiste el turno (evaluación, aplazados, entrega, espera, usage,
// latencia, versión) y avisa. Cero lógica de agente aquí. Modo A
// simplificado: cada borrador del agente se envía TAL CUAL como lo haría la
// coordinadora (autor persona, sugerido por IA) — límite escrito.
//
//   npm run hilos:jugar                       juega los 15 guiones
//   npm run hilos:jugar -- --solo a,b         solo esos ids
//   npm run hilos:jugar -- --turnos 4         tope de turnos por hilo
//   npm run hilos:veredictos                  lee evals/hilos-jugados/fixture.md → fixture.json
//
// CANDADOS: solo DEMO (la base tiene que tener las cuatro «Clínica Demo»;
// app.cliente='DEMO' en cada consulta; nada sale por WhatsApp, la DEMO no
// tiene número) y solo con el interruptor del agente ENCENDIDO en la clínica
// del guion (si no, ese mensaje no se evaluaría en producción).
//
// COSTE (medido 22-08 / estimado): evaluador + control ≈ $0,009 por turno en
// haiku; el paciente en sonnet ≈ $0,01 por turno. 15 hilos × ≤7 turnos ≈
// $2. Se apunta en evals/pasadas/GASTO.md. Salidas: 0 · 1 mal uso o
// interruptor apagado · 2 entorno.
//
// Lo jugado se guarda INCREMENTALMENTE en evals/hilos-jugados/fixture.json
// (si esto muere a medias, queda lo jugado) y se renderiza a fixture.md
// para anotar. El fixture guarda por turno la ENTRADA exacta del evaluador
// y los hashes de versión: `hilos:replay` lo rejuega contra el prompt de hoy.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runWithCliente } from "../app/lib/airtable";
import { evaluadorActivo } from "../app/lib/automatizacion/pg";
import { semaforoDeContacto } from "../app/lib/automatizacion/semaforo";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { confirmarEnvioManual } from "../app/lib/mensajeria/confirmar-envio";
import { contenidoEntrante } from "../app/lib/mensajeria/tipos-mensaje";
import { hoyISO } from "../app/lib/time";
import { costeUsdDeTurno, type UsageTurno } from "../app/lib/agente/coste";
import { leerPayloadEvaluacion } from "../app/lib/agente/persistir-turno";
import { FUENTE_SIMULACION } from "../app/lib/mensajeria/hilo-jugado";
import {
  LIMITES_HILOS_JUGADOS,
  RUTA_FIXTURE,
  RUTA_FIXTURE_MD,
  renderFixtureMd,
  decisionDePersistido,
  type FixtureHilos,
  type HiloJugado,
  type TurnoJugado,
  type MensajeJugado,
  type EventoJugado,
  type FinMotivo,
  type Guion,
} from "../app/lib/agente/hilos-jugados";
import { GUIONES } from "./hilos-jugados-guiones.mts";
import { crearQ, candadoDemo, clinicaDemo, doctorDemo, construirMundo, limpiarHilo, enviarCadencia, type Q } from "./hilos-jugados-mundo.mts";

const MODELO_PACIENTE = "claude-sonnet-5";

// ─── argumentos ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function sacarFlag(nombre: string): string | null {
  const i = argv.indexOf(nombre);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v) {
    console.error(`✗ ${nombre} necesita un valor.`);
    process.exit(1);
  }
  argv.splice(i, 2);
  return v;
}
const solo = sacarFlag("--solo");
const topeTurnos = sacarFlag("--turnos");
// (Los veredictos se marcan EN LA INTERFAZ y los copia al fixture
//  `db-seed-hilos-jugados --guardar-veredictos`; aquí no hay Markdown.)

// ─── entorno y candados ─────────────────────────────────────────────────────

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} en .env.local — no puedo jugar.`);
    process.exit(2);
  }
}
if (process.env.DATA_BACKEND_PG_CLIENTES !== "DEMO" && !process.env.DATA_BACKEND_PG_CLIENTES!.split(",").includes("DEMO")) {
  console.error("✗ Candado: este script solo escribe en DEMO y DATA_BACKEND_PG_CLIENTES no la incluye.");
  process.exit(1);
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
try {
  await app.connect();
  await admin.connect();
} catch (err) {
  console.error("✗ No se pudo conectar a la base:", err instanceof Error ? err.message : String(err));
  process.exit(2);
}
const q: Q = crearQ(app);
try {
  await candadoDemo(q);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const guiones: Guion[] = solo ? GUIONES.filter((g) => solo.split(",").includes(g.id)) : GUIONES;
if (solo && guiones.length !== solo.split(",").length) {
  console.error(`✗ --solo: ids desconocidos. Válidos: ${GUIONES.map((g) => g.id).join(", ")}`);
  process.exit(1);
}
const tope = topeTurnos ? Number(topeTurnos) : null;
if (topeTurnos && (!Number.isInteger(tope) || tope! < 1)) {
  console.error("✗ --turnos tiene que ser un entero ≥ 1.");
  process.exit(1);
}

const estimado = guiones.reduce((s, g) => s + Math.min(g.maxTurnos + (g.sigueTrasDerivar ?? 0), tope ?? 99) * 0.02, 0);
console.log(`Jugando ${guiones.length} hilos (paciente: ${MODELO_PACIENTE} · agente: producción). Coste estimado tope: $${estimado.toFixed(2)}.`);

// ─── el paciente (modelo) ──────────────────────────────────────────────────

type Espejo = { direccion: "Entrante" | "Saliente"; contenido: string; quien: "paciente" | "agente" | "cadencia" };

function systemPaciente(g: Guion): string {
  return [
    `Eres una persona que escribe por WhatsApp a una clínica dental española. Interpretas a este paciente y SOLO a este paciente.`,
    ``,
    `PERFIL: ${g.paciente.perfil}`,
    `LO QUE QUIERES CONSEGUIR: ${g.paciente.objetivo}`,
    g.paciente.ruido ? `CÓMO ESCRIBES: ${g.paciente.ruido}` : `CÓMO ESCRIBES: como una persona real por WhatsApp.`,
    ``,
    `REGLAS:`,
    `- Mensajes cortos: una a tres frases. Sin listas, sin formalidad, sin firmar.`,
    `- No repitas con las mismas palabras lo que ya dijiste. Si insistes, insiste de otra manera.`,
    `- No inventes datos que el perfil no te da, salvo detalles menores coherentes con él.`,
    `- No hagas de clínica: tú eres el paciente. Reacciona a lo que te contestan.`,
    `- Responde SOLO con el texto del mensaje, sin comillas, sin prefijos, sin acotaciones.`,
    `- Cuando ya conseguiste lo que querías, o te han dicho claramente que una persona te llamará o se ocupa, o no tiene sentido seguir, responde exactamente: FIN`,
  ].join("\n");
}

function mensajesParaPaciente(espejo: Espejo[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of espejo) {
    const role = m.direccion === "Entrante" ? "assistant" : "user";
    const content = m.direccion === "Entrante" ? m.contenido : `${m.quien === "cadencia" ? "[Mensaje automático de la clínica] " : ""}${m.contenido}`;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n${content}`;
    else out.push({ role, content });
  }
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", content: "(Empieza tú la conversación con tu primer mensaje.)" });
  if (out[out.length - 1].role === "assistant") out.push({ role: "user", content: "(La clínica no ha contestado todavía. Escribe tu siguiente mensaje, o FIN si ya no tiene sentido seguir.)" });
  return out;
}

async function pacienteDice(g: Guion, espejo: Espejo[]): Promise<{ texto: string; usage: UsageTurno }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_PACIENTE,
      max_tokens: 220,
      // (sin temperature: sonnet 5 la rechaza como obsoleta; el fixture se
      // juega una vez, la variedad la pone el perfil)
      system: systemPaciente(g),
      messages: mensajesParaPaciente(espejo),
    }),
  });
  if (!res.ok) throw new Error(`Paciente (modelo): ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  const texto = String(data.content?.find((c: any) => c.type === "text")?.text ?? "").trim();
  const u = data.usage ?? {};
  return {
    texto,
    usage: {
      inputTokens: Number(u.input_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      cacheEscritura: Number(u.cache_creation_input_tokens ?? 0),
      cacheLectura: Number(u.cache_read_input_tokens ?? 0),
    },
  };
}

const esFin = (t: string) => /^\s*\*{0,2}FIN\*{0,2}[.!]?\s*$/i.test(t);

// ─── leer lo persistido ────────────────────────────────────────────────────

async function eventosDe(telefono: string): Promise<EventoJugado[]> {
  const r = await q(
    `select evento, actor_nombre, mensaje_id, created_at, motivo_texto, clave_aplazado, causa_derivacion, malestar, objetivo_activo, hasta, evaluacion_json
       from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = $1 order by created_at, id`,
    [telefono],
  );
  return r.rows.map((e: any) => ({
    evento: String(e.evento),
    actorNombre: e.actor_nombre ?? null,
    mensajeId: e.mensaje_id ? String(e.mensaje_id) : null,
    createdAt: new Date(e.created_at).toISOString(),
    motivoTexto: e.motivo_texto ?? null,
    claveAplazado: e.clave_aplazado ?? null,
    causaDerivacion: e.causa_derivacion ?? null,
    malestar: e.malestar ?? null,
    objetivoActivo: e.objetivo_activo ?? null,
    hasta: e.hasta ? (e.hasta instanceof Date ? e.hasta.toISOString().slice(0, 10) : String(e.hasta).slice(0, 10)) : null,
    evaluacion: e.evaluacion_json ? leerPayloadEvaluacion(e.evaluacion_json) : null,
  }));
}

async function mensajesDe(telefono: string): Promise<MensajeJugado[]> {
  const r = await q(
    `select waba_message_id, direccion, contenido, "timestamp", autor, sugerido_por_ia, fuente, tipo, nombre_perfil, procesado_por_ia, paciente_id, presupuesto_id
       from mensajes_whatsapp where telefono = $1 order by "timestamp", id`,
    [telefono],
  );
  return r.rows.map((m: any) => ({
    wabaMessageId: m.waba_message_id ? String(m.waba_message_id) : null,
    direccion: m.direccion === "Entrante" ? "Entrante" : "Saliente",
    contenido: String(m.contenido ?? ""),
    timestamp: new Date(m.timestamp).toISOString(),
    autor: m.autor ?? null,
    sugeridoPorIa: m.sugerido_por_ia === true,
    fuente: m.fuente ?? null,
    tipo: m.tipo ?? null,
    nombrePerfil: m.nombre_perfil ?? null,
    procesadoPorIa: m.procesado_por_ia === true,
    conPaciente: m.paciente_id != null,
    conPresupuesto: m.presupuesto_id != null,
  }));
}

// ─── el fixture, incremental ───────────────────────────────────────────────

const jugadoEl = new Date().toISOString();
let fixture: FixtureHilos = { v: 1, jugadoEl, modeloPaciente: MODELO_PACIENTE, limites: LIMITES_HILOS_JUGADOS, hilos: [], coste: { usdAgente: 0, usdPaciente: 0, usdTotal: 0 } };
if (solo && existsSync(RUTA_FIXTURE)) {
  // --solo rejuega unos hilos y conserva el resto del fixture.
  const previo = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
  fixture = { ...previo, limites: LIMITES_HILOS_JUGADOS, hilos: previo.hilos.filter((h) => !guiones.some((g) => g.id === h.guion.id)) };
}
function guardarFixture() {
  fixture.coste = fixture.hilos.reduce(
    (s, h) => ({ usdAgente: s.usdAgente + h.coste.usdAgente, usdPaciente: s.usdPaciente + h.coste.usdPaciente, usdTotal: s.usdTotal + h.coste.usdAgente + h.coste.usdPaciente }),
    { usdAgente: 0, usdPaciente: 0, usdTotal: 0 },
  );
  fixture.hilos.sort((a, b) => GUIONES.findIndex((g) => g.id === a.guion.id) - GUIONES.findIndex((g) => g.id === b.guion.id));
  mkdirSync(dirname(RUTA_FIXTURE), { recursive: true });
  writeFileSync(RUTA_FIXTURE, JSON.stringify(fixture, null, 2));
  writeFileSync(RUTA_FIXTURE_MD, renderFixtureMd(fixture));
}

// ─── jugar un hilo ─────────────────────────────────────────────────────────

const linea = () => console.log("─".repeat(72));

async function jugar(g: Guion): Promise<HiloJugado> {
  linea();
  console.log(`▶ ${g.id} · ${g.titulo}`);
  const clinica = await clinicaDemo(q, g.clinica);
  const doctor = await doctorDemo(q);
  const hoy = hoyISO();
  const encendido = await runWithCliente("DEMO", () => evaluadorActivo(clinica.id));
  if (!encendido) {
    console.error(`✗ El agente está APAGADO en ${clinica.nombre}: este hilo no se evaluaría en producción. Enciéndelo: npm run demo:entrante -- --on ${g.clinica}`);
    process.exit(1);
  }
  await limpiarHilo({ q, admin, telefono: g.telefono, nombrePaciente: g.mundo.paciente?.nombre ?? null });
  const mundo = await construirMundo({ q, mundo: g.mundo, telefono: g.telefono, clinicaId: clinica.id, doctorNombre: doctor, diaHilo: hoy });

  const espejo: Espejo[] = [];
  const turnos: TurnoJugado[] = [];
  let usdAgente = 0;
  let usdPaciente = 0;
  let sinTarifa = 0;
  let fin: { motivo: FinMotivo; detalle: string | null } = { motivo: "max_turnos", detalle: null };
  let derivadoEn: number | null = null;
  const maxTurnos = Math.min(g.maxTurnos + (g.sigueTrasDerivar ?? 0), tope ?? 99);

  await runWithCliente("DEMO", async () => {
    const servicio = getServicioMensajeria("waba");
    const manual = getServicioMensajeria("manual");
    for (let n = 1; n <= maxTurnos; n++) {
      // Pasos del guion antes de este turno: cadencias con la plantilla real.
      for (const paso of g.pasos ?? []) {
        if (paso.antesDelTurno !== n || paso.tipo === "entrante_no_legible") continue;
        const cita = g.mundo.cita ? { fecha: n === 1 && g.mundo.cita.enDias === 1 ? "mañana" : `en ${g.mundo.cita.enDias} días`, hora: g.mundo.cita.hora } : null;
        const { contenido, plantilla } = await enviarCadencia({
          q,
          tipo: paso.tipo,
          telefono: g.telefono,
          nombre: g.mundo.paciente?.nombre ?? g.nombrePerfil ?? "",
          presupuestoId: mundo.presupuestoId,
          pacienteId: mundo.pacienteId,
          tratamiento: g.mundo.presupuesto?.tratamiento ?? g.mundo.cita?.tratamiento ?? "tu tratamiento",
          importe: g.mundo.presupuesto?.importe,
          doctor,
          clinica: clinica.nombre,
          cita,
        });
        espejo.push({ direccion: "Saliente", contenido, quien: "cadencia" });
        console.log(`  ⤵ cadencia (${plantilla}): «${contenido.slice(0, 70)}…»`);
      }

      // Semáforo antes de escribir: en rojo (no espera) el agente no actúa.
      // Se persiste igual (así hace el webhook) para ENSEÑAR el hilo en rojo.
      const sem = await semaforoDeContacto(g.telefono, { hoy });
      const enRojo = !sem.verde && sem.motivo !== "espera";

      // El entrante: del modelo, o forzado por el guion (audio, 034).
      const noLegible = (g.pasos ?? []).find((p) => p.antesDelTurno === n && p.tipo === "entrante_no_legible");
      let contenido: string;
      let tipo: "text" | "audio" | "image" | "document" = "text";
      if (noLegible && noLegible.tipo === "entrante_no_legible") {
        tipo = noLegible.mensajeTipo;
        contenido = contenidoEntrante(tipo, {});
      } else {
        const p = await pacienteDice(g, espejo);
        const c = costeUsdDeTurno(p.usage, MODELO_PACIENTE);
        if (c == null) sinTarifa++;
        else usdPaciente += c;
        if (esFin(p.texto)) {
          fin = { motivo: derivadoEn != null ? "derivado" : "fin_paciente", detalle: derivadoEn != null ? `el paciente paró tras la entrega` : null };
          console.log(`  ■ paciente: FIN`);
          return;
        }
        contenido = p.texto;
      }
      const mensajeId = `jug_${g.id}_${n}`;
      await servicio.recibirMensaje({
        telefono: g.telefono,
        contenido,
        tipo,
        presupuestoId: mundo.presupuestoId ?? undefined,
        nombrePerfil: g.mundo.paciente ? null : (g.nombrePerfil ?? null),
        clinicaId: clinica.id,
        wabaMessageId: mensajeId,
        fuente: FUENTE_SIMULACION,
      });
      espejo.push({ direccion: "Entrante", contenido, quien: "paciente" });
      console.log(`  → paciente${tipo !== "text" ? ` (${tipo})` : ""}: «${contenido.slice(0, 90)}${contenido.length > 90 ? "…" : ""}»`);

      const res = await evaluarEntranteConversacion({ telefono: g.telefono, mensajeId, contenido, tipo, presupuestoId: mundo.presupuestoId, clinicaId: clinica.id, hoy });
      const evsTurno = (await eventosDe(g.telefono)).filter((e) => e.mensajeId === mensajeId);
      const payload = evsTurno.find((e) => e.evento === "evaluacion")?.evaluacion ?? null;
      const decision = decisionDePersistido(payload, evsTurno);
      const cAg = payload ? costeUsdDeTurno(payload.usage, payload.modelo) : null;
      if (payload && cAg == null) sinTarifa++;
      else if (cAg != null) usdAgente += cAg;
      turnos.push({
        n,
        mensajeId,
        entrante: contenido,
        entrada: res.estado === "evaluado" ? res.entrada : null,
        version: payload?.version ?? null,
        usage: payload?.usage ?? null,
        modelo: payload?.modelo ?? null,
        latenciaMs: payload?.latenciaMs ?? null,
        decision,
      });

      if (res.estado === "fallo") {
        fin = { motivo: "fallo", detalle: res.motivo };
        console.log(`  ✗ el agente falló: ${res.motivo}`);
        return;
      }
      if (enRojo || res.estado === "saltado") {
        console.log(`  · el agente calla (${enRojo ? `semáforo en rojo: ${sem.motivo ?? "?"}` : res.estado === "saltado" ? res.motivo : "evaluado"})`);
      } else if (decision) {
        console.log(`  ← agente: ${decision.decision === "deriva" ? `PASA A PERSONA (${decision.causa} · ${decision.cola})` : "sigue"}${decision.aplazados.length ? ` · aplaza ${decision.aplazados.join(",")}` : ""}${decision.descarte ? ` · control descartó (${decision.descarte})` : ""}${decision.pideNoContacto ? " · opt-out" : ""}`);
      }

      // Modo A simplificado: el borrador se envía tal cual, como la coordinadora.
      if (decision?.respuesta?.trim()) {
        const env = await manual.enviarMensaje({
          telefono: g.telefono,
          contenido: decision.respuesta,
          autor: "persona",
          sugeridoPorIa: true,
          ...(mundo.presupuestoId ? { presupuestoId: mundo.presupuestoId } : {}),
          ...(mundo.pacienteId ? { pacienteId: mundo.pacienteId } : {}),
        });
        await confirmarEnvioManual(env.mensajeId);
        espejo.push({ direccion: "Saliente", contenido: decision.respuesta, quien: "agente" });
        console.log(`    «${decision.respuesta.slice(0, 110)}${decision.respuesta.length > 110 ? "…" : ""}»`);
      }

      if (decision?.pideNoContacto) {
        fin = { motivo: "opt_out", detalle: null };
        return;
      }
      if (decision?.decision === "deriva" && derivadoEn == null) {
        derivadoEn = n;
        fin = { motivo: "derivado", detalle: decision.causa };
        if (!g.sigueTrasDerivar) return;
      }
      if (derivadoEn != null && n >= derivadoEn + (g.sigueTrasDerivar ?? 0)) return;
      if (n === g.maxTurnos + (g.sigueTrasDerivar ?? 0) && derivadoEn == null) fin = { motivo: "max_turnos", detalle: null };
    }
  });

  const hilo: HiloJugado = {
    guion: g,
    jugadoEl,
    hoy,
    fin,
    mensajes: await mensajesDe(g.telefono),
    eventos: await eventosDe(g.telefono),
    turnos,
    coste: { usdAgente: round6(usdAgente), usdPaciente: round6(usdPaciente), turnosSinTarifa: sinTarifa },
    veredicto: { valor: null, nota: null },
  };
  console.log(`  fin: ${fin.motivo}${fin.detalle ? ` (${fin.detalle})` : ""} · ${turnos.length} turnos · agente $${usdAgente.toFixed(4)} · paciente $${usdPaciente.toFixed(4)}`);
  return hilo;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

// ─── correr ────────────────────────────────────────────────────────────────

let salida = 0;
for (const g of guiones) {
  try {
    const hilo = await jugar(g);
    fixture.hilos.push(hilo);
  } catch (err) {
    salida = 2;
    console.error(`✗ ${g.id}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
  guardarFixture();
}
linea();
console.log(`Jugados ${fixture.hilos.length} hilos · agente $${fixture.coste.usdAgente.toFixed(4)} · paciente $${fixture.coste.usdPaciente.toFixed(4)} · total $${fixture.coste.usdTotal.toFixed(4)}`);
console.log(`Fixture: ${RUTA_FIXTURE} (vista de lectura: ${RUTA_FIXTURE_MD}). Se anota en Mensajería › «Jugadas» › ver por qué.`);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
await app.end();
await admin.end();
process.exit(salida);
