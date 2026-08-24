// F7 (fase F) — EL RESULTADO FINAL Y SU MOTIVO, desde el log del agente.
//
// El agente ya recoge `motivo_rechazo` y `que_le_frena` (objetivo
// presupuesto), pero viven solo en `evaluacion_json` del log — las columnas
// `motivo_perdida` / `motivo_no_interes` las escribe la PERSONA al cerrar
// (escritor único humano; la proyección continua murió en B4 con razón).
// F7 cierra el hueco sin resucitarla: el modal de cierre PRE-RELLENA lo que
// el agente recogió, la persona confirma y la columna se escribe UNA vez.
//
// MÓDULO PURO (sin DB, client-safe): lo testea qa:ficha. La lectura del log
// vive en /api/agente/motivo-sugerido; los modales solo pintan.

import type { MotivoPerdida } from "../presupuestos/types";
import type { MotivoLead } from "../leads/motivos";

export type MotivoDelLog = {
  /** La frase del paciente que el agente extrajo — el CONTEXTO que se
   *  enseña siempre; las preselecciones salen de ella. */
  frase: string;
  decision: string | null;
  motivoRechazo: string | null;
  queLeFrena: string | null;
  /** ISO del juicio del que salió — la persona ve de cuándo es el dato. */
  fechaISO: string | null;
};

const conValor = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && v !== "no_aplica";

/** Recorre los payloads de `evaluacion` (orden cronológico ASC) hacia atrás
 *  y devuelve el último juicio con motivo de rechazo o freno recogido.
 *  null = el agente no recogió nada: el modal sale como siempre. */
export function extraerMotivoDelLog(
  eventos: ReadonlyArray<{ evaluacionJson: unknown; createdAtISO: string | null }>,
): MotivoDelLog | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const raw = eventos[i].evaluacionJson;
    if (raw == null) continue;
    let pj: any;
    try {
      pj = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      continue; // payload ilegible: se ignora, no se inventa
    }
    const pre = pj?.camposRecogidos?.["presupuesto"];
    if (pre == null || typeof pre !== "object") continue;
    const motivoRechazo = conValor(pre["motivo_rechazo"]) ? pre["motivo_rechazo"].trim() : null;
    const queLeFrena = conValor(pre["que_le_frena"]) ? pre["que_le_frena"].trim() : null;
    if (!motivoRechazo && !queLeFrena) continue;
    return {
      frase: motivoRechazo ?? queLeFrena!,
      decision: conValor(pre["decision"]) ? pre["decision"].trim() : null,
      motivoRechazo,
      queLeFrena,
      fechaISO: eventos[i].createdAtISO,
    };
  }
  return null;
}

// ─── El mapeo léxico texto→enum, CONSERVADOR a propósito ────────────────────
//
// La frase es texto libre («me parece muy caro», «se lo hace en otra
// clínica»). Preseleccionar el enum equivocado es peor que no preseleccionar
// nada — la persona confirma con un clic y un error suyo es un dato falso en
// la columna que audita Tablas. Solo mapean las señales inequívocas; ante la
// duda, null (la frase queda como contexto y la persona elige).

const norm = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function sugerirMotivoPerdida(frase: string): MotivoPerdida | null {
  const t = norm(frase);
  if (/financiaci|financiar|a plazos|en cuotas/.test(t)) return "necesita_financiacion";
  if (/\bcar[oa]\b|precio|dinero|no me lo puedo permitir|presupuesto muy alto/.test(t)) return "precio_alto";
  if (/otra clinica|otro dentista|otro sitio|competencia|se lo hace (con|en)/.test(t)) return "otra_clinica";
  if (/miedo|panico|terror|fobia/.test(t)) return "miedo_tratamiento";
  if (/sin prisa|no (le |me )?urge|mas adelante|no lo ve urgente|de momento no/.test(t)) return "sin_urgencia";
  return null;
}

export function sugerirMotivoLead(frase: string): MotivoLead | null {
  const t = norm(frase);
  if (/\bcar[oa]\b|precio|dinero|no me lo puedo permitir/.test(t)) return "Precio";
  if (/otra clinica|otro dentista|otro sitio|competencia/.test(t)) return "Otra_Clinica";
  if (/horario|no le cuadra|no puede venir|no coincide/.test(t)) return "Horarios";
  if (/ya no (lo )?necesit|se le paso|ya se lo (hizo|hicieron)|resuelto/.test(t)) return "Ya_No_Necesita";
  return null;
}
