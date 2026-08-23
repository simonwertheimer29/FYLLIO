#!/usr/bin/env tsx
// AGUANTE del agente (encargo 22-08): cuántos turnos aguanta una conversación
// de lead antes de derivar, PROMPT ACTUAL contra el de ANTES de los arreglos
// de agenda (975758f) — mismo código, mismo guion: aísla el efecto del
// prompt. Si el aguante bajó, la cautela nos pasó de frenada.
//
// La decisión deriva/sigue NO depende del juez (solo toca la respuesta), así
// que la comparación es limpia aunque el juez actual corra en ambos lados.
// El guion del paciente es fijo (ignora las respuestas): métrica de aguante,
// no de calidad. 2 prompts × 3 repeticiones × ≤6 turnos ≈ $0,35.
// Salida completa a evals/pasadas/ (regla del fichero). Salidas §9: 0 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { evaluarTurno } from "../app/lib/agente/evaluador";
import { construirEntradaDePrueba, type TurnoPrueba } from "../app/lib/agente/banco-pruebas";
import { OBJETIVOS_POR_DEFECTO } from "../app/lib/automatizacion/objetivos";

if (!process.env.ANTHROPIC_API_KEY) { console.error("✗ sin clave"); process.exit(2); }

const VIEJO_PATH = process.argv[2];
if (!VIEJO_PATH) { console.error("uso: medir-aguante.mts <fichero evaluador viejo>"); process.exit(2); }
const src = readFileSync(VIEJO_PATH, "utf8");
const m = /export const SYSTEM_PROMPT_EVALUADOR = `([\s\S]*?)`;\n/.exec(src);
if (!m) { console.error("✗ no se pudo extraer el SYSTEM viejo"); process.exit(2); }
const SYSTEM_VIEJO = m[1];

const GUION = [
  "Hola, ¿hacéis revisiones de ortodoncia?",
  "Genial. ¿Y cuánto me costaría más o menos?",
  "Vale. Soy Marta, me viene bien por las tardes",
  "Mejor a partir de las 17:00",
  "No, sin prisa, es una revisión normal",
  "Perfecto, gracias",
];

async function correr(etiqueta: string, override?: string): Promise<number[]> {
  const aguantes: number[] = [];
  for (let rep = 1; rep <= 3; rep++) {
    const hilo: TurnoPrueba[] = [];
    let turnoDeriva = GUION.length + 1; // no derivó en el guion
    for (let t = 0; t < GUION.length; t++) {
      const entrada = construirEntradaDePrueba({
        escenario: { tipo: "lead_nuevo" },
        hilo, mensaje: GUION[t],
        conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO,
        clinicaNombre: "Clínica Aguante", derivadoPrevio: false, hoy: "2026-08-22",
      });
      const ev = await evaluarTurno(entrada, override ? { _promptOverride: override } as any : undefined);
      if (ev.fallback) { console.error("  ⚠ fallback — pasada no fiable"); process.exit(2); }
      hilo.push({ direccion: "Entrante", contenido: GUION[t] });
      hilo.push({ direccion: "Saliente", contenido: ev.respuesta });
      if (ev.decision === "deriva") {
        turnoDeriva = t + 1;
        console.log(`  [${etiqueta} rep${rep}] deriva en turno ${t + 1} (${ev.causa}) · faltantes al derivar: ${ev.camposFaltantes.join(",") || "NINGUNO — entrega cocinada"} · recogido: ${JSON.stringify(ev.camposRecogidos[ev.objetivoActivo ?? "cita"] ?? {})}`);
        break;
      }
    }
    if (turnoDeriva > GUION.length) console.log(`  [${etiqueta} rep${rep}] NO derivó en ${GUION.length} turnos`);
    aguantes.push(turnoDeriva);
  }
  return aguantes;
}

console.log("── PROMPT PRE-AGENDA (975758f) ──");
const antes = await correr("viejo", SYSTEM_VIEJO);
console.log("── PROMPT ACTUAL ──");
const ahora = await correr("actual");
const media = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
console.log(`\n══ AGUANTE (turnos hasta derivar; ${GUION.length + 1} = no derivó en el guion)`);
console.log(`  pre-agenda: ${antes.join(", ")} → media ${media(antes)}`);
console.log(`  actual:     ${ahora.join(", ")} → media ${media(ahora)}`);
console.log(Number(media(ahora)) < Number(media(antes))
  ? "  ⚠ EL AGUANTE BAJÓ — la cautela se pasó de frenada."
  : "  ✓ el aguante NO bajó respecto a pre-agenda.");
