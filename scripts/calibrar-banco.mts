#!/usr/bin/env tsx
// CALIBRACIÓN del banco de pruebas (fase E, paso 3): una conversación corta
// por escenario, con modelo REAL, para ver que el panel «qué ha hecho por
// dentro» recibe juicios coherentes en los cuatro. Salida completa a
// evals/pasadas/ (regla 22-08: nunca se repite una pasada para releer).
//
//   npx tsx scripts/calibrar-banco.mts   (~8 turnos, ~$0.07)
//
// Con config de clínica DE MENTIRA cargada en memoria no se puede (probarTurno
// lee la de la DB — a propósito: es el ciclo real), así que se usa una
// clínica sintética sin fila → defaults. Salidas §9: 0 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { probarTurno, type EscenarioPrueba, type TurnoPrueba } from "../app/lib/agente/banco-pruebas";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ Falta ANTHROPIC_API_KEY — no se puede calibrar.");
  process.exit(2);
}

const CLINICA = "qa-calibracion-banco";

const CONVERSACIONES: Array<{ escenario: EscenarioPrueba; mensajes: string[] }> = [
  { escenario: { tipo: "lead_nuevo", nombre: "Lucía" },
    mensajes: ["Hola, ¿hacéis ortodoncia invisible? ¿Cuánto cuesta más o menos?", "Vale. Soy Lucía, nunca he ido. Por las tardes me viene bien."] },
  { escenario: { tipo: "presupuesto", tratamiento: "Implante", importe: 1900 },
    mensajes: ["He estado pensando el presupuesto del implante… ¿me lo podéis dejar en cuotas?", "Vale, pues adelante entonces. ¿Cuándo podría empezar?"] },
  { escenario: { tipo: "cobro", deuda: 600 },
    mensajes: ["Me ha llegado el aviso del pago. Ahora mismo no puedo pagarlo todo…"] },
  { escenario: { tipo: "al_dia" },
    mensajes: ["Hola, me duele muchísimo una muela desde anoche, ¿me podéis ver hoy?"] },
];

let fallbacks = 0;
await runWithCliente("DEMO", async () => {
  for (const conv of CONVERSACIONES) {
    console.log(`\n════ ESCENARIO: ${conv.escenario.tipo} ════`);
    const hilo: TurnoPrueba[] = [];
    let derivado = false;
    for (const mensaje of conv.mensajes) {
      console.log(`\nPaciente: «${mensaje}»`);
      const r = await probarTurno({
        clinicaId: CLINICA, clinicaNombre: "Clínica Calibración",
        escenario: conv.escenario, hilo, mensaje, derivadoPrevio: derivado,
      });
      const ev = r.evaluacion;
      if (ev.fallback) { fallbacks++; console.log("  ⚠ FALLBACK"); continue; }
      if (!ev.actuar) { console.log("  (no actúa — ya derivado)"); continue; }
      console.log(`Agente: «${ev.respuesta}»`);
      console.log(`  · entendió: tema=${ev.juicios?.tema} urgencia=${ev.juicios?.urgenciaMedica} queja=${ev.juicios?.peticionOQueja}`);
      console.log(`  · persigue: ${ev.objetivoActivo ?? "nada"} · faltan: ${ev.camposFaltantes.join(",") || "—"} · completo: ${ev.casoCompleto}`);
      if (ev.aplazamientos.length) console.log(`  · anotó: ${ev.aplazamientos.map((a) => `${a.clave}(«${a.motivo}»)`).join(" · ")}`);
      console.log(`  · decidió: ${ev.decision}${ev.causa ? ` (${ev.causa}, cola ${ev.cola})` : ""}`);
      if (ev.borradorDescartado) console.log(`  · JUEZ descartó (${ev.borradorDescartado.motivo}): «${ev.borradorDescartado.frase ?? ""}»`);
      hilo.push({ direccion: "Entrante", contenido: mensaje });
      hilo.push({ direccion: "Saliente", contenido: ev.respuesta });
      if (ev.decision === "deriva") derivado = true;
    }
  }
});

const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
await admin.connect();
await admin.query(`delete from uso_banco_pruebas where clinica_id = $1`, [CLINICA]);
await admin.end();
console.log(`\n${fallbacks === 0 ? "✓" : "⚠"} calibración: ${fallbacks} fallback(s); contador de la clínica sintética limpiado`);
process.exit(fallbacks > 0 ? 2 : 0);
