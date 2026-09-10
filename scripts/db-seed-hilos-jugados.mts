#!/usr/bin/env tsx
// scripts/db-seed-hilos-jugados.mts — RESIEMBRA el fixture de hilos jugados
// (10-09). Corre dentro de `demo:reset`, después del seed rico (que ha
// vaciado todo) y antes de las fotos de Inicio y del backfill de métricas.
//
// No juega nada: lee evals/hilos-jugados/fixture.json y lo escribe corrido
// en fechas — cada hilo `haceDias` días antes de hoy, con su mini-mundo
// (paciente, presupuesto, pago, cita) fechado en relación al día del hilo.
// Los eventos van con su payload real (usage, latencia, versión); los
// entrantes llevan `fuente = 'Simulacion'` (la marca) y los salientes del
// agente `autor = 'persona' + sugerido_por_ia` (modo A). Reproducible: el
// mismo fixture da la misma demo cada vez.
//
// Sin fixture: avisa y sale 0 — un reset sin hilos jugados es válido (la
// primera vez, o si se decidió no jugarlos). Solo DEMO (candado).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { hoyISO } from "../app/lib/time";
import { RUTA_FIXTURE, desplazarHilo, diasEntre, type FixtureHilos } from "../app/lib/agente/hilos-jugados";
import { crearQ, candadoDemo, clinicaDemo, doctorDemo, construirMundo, type Q } from "./hilos-jugados-mundo.mts";

if (!existsSync(RUTA_FIXTURE)) {
  console.log(`hilos jugados: no hay ${RUTA_FIXTURE} — se salta (juega con npm run hilos:jugar cuando quieras).`);
  process.exit(0);
}
if (!process.env.SUPABASE_DB_URL_APP) {
  console.error("✗ Falta SUPABASE_DB_URL_APP.");
  process.exit(2);
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
const q: Q = crearQ(app);
await candadoDemo(q);

const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
const hoy = hoyISO();
const doctor = await doctorDemo(q);

function masDias(fecha10: string, dias: number): string {
  return new Date(new Date(`${fecha10}T00:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);
}

async function ins(tabla: string, row: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  const r = await q(`insert into ${tabla} (${cols.join(",")}) values (${ph}) returning id`, vals);
  return String(r.rows[0].id);
}

let nMensajes = 0;
let nEventos = 0;
let nOptOuts = 0;
for (const original of fixture.hilos) {
  const g = original.guion;
  const delta = diasEntre(fixture.jugadoEl, hoy) - g.haceDias;
  const h = desplazarHilo(original, delta);
  const diaHilo = masDias(hoy, -g.haceDias);
  const clinica = await clinicaDemo(q, g.clinica);
  const mundo = await construirMundo({ q, mundo: g.mundo, telefono: g.telefono, clinicaId: clinica.id, doctorNombre: doctor, diaHilo });

  for (const m of h.mensajes) {
    await ins("mensajes_whatsapp", {
      cliente: "DEMO",
      telefono: g.telefono,
      clinica_id: clinica.id,
      paciente_id: m.conPaciente ? mundo.pacienteId : null,
      presupuesto_id: m.conPresupuesto ? mundo.presupuestoId : null,
      direccion: m.direccion,
      contenido: m.contenido,
      timestamp: m.timestamp,
      fuente: m.fuente,
      autor: m.autor,
      sugerido_por_ia: m.direccion === "Saliente" ? m.sugeridoPorIa : null,
      tipo: m.tipo ?? "text",
      nombre_perfil: m.nombrePerfil,
      procesado_por_ia: m.procesadoPorIa,
      waba_message_id: m.wabaMessageId,
    });
    nMensajes++;
  }
  for (const e of h.eventos) {
    await ins("eventos_automatizacion", {
      cliente: "DEMO",
      tipo_caso: "conversacion",
      caso_id: g.telefono,
      evento: e.evento,
      actor_nombre: e.actorNombre ?? "agente",
      motivo_texto: e.motivoTexto,
      clave_aplazado: e.claveAplazado,
      causa_derivacion: e.causaDerivacion,
      malestar: e.malestar,
      objetivo_activo: e.objetivoActivo,
      hasta: e.hasta,
      evaluacion_json: e.evaluacion ? JSON.stringify(e.evaluacion) : null,
      mensaje_id: e.mensajeId,
      created_at: e.createdAt,
    });
    nEventos++;
  }
  // El opt-out vive en el log de la conversación (MEJORAS 135, fuente única):
  // el evento `opt_out` viaja en el fixture como uno más y se copia con su
  // actor. No se vuelve a marcar: sería un segundo evento.
  if (h.eventos.some((e) => e.evento === "opt_out")) nOptOuts++;
  console.log(`  ${g.id}: ${h.mensajes.length} mensajes · ${h.eventos.length} eventos · hace ${g.haceDias} días · ${clinica.nombre}`);
}
console.log(`hilos jugados: ${fixture.hilos.length} hilos · ${nMensajes} mensajes · ${nEventos} eventos · ${nOptOuts} opt-out (fixture del ${fixture.jugadoEl.slice(0, 10)})`);
await app.end();
