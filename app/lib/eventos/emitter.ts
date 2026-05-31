// app/lib/eventos/emitter.ts
// Sprint 18 Bloque 2 — emisión de eventos comportamentales a Supabase.
//
// CONTRATO CLAVE: esta función NUNCA debe bloquear ni romper el flujo operacional
// principal. Si Supabase está caído o no configurado, captura el error, lo loguea
// y sigue. Reintenta 3x con backoff lineal. No lanza nunca.
//
// SIN PII: el caller es responsable de pasar solo IDs y datos sanitizados en
// `contexto` / `estadoPaciente` (nunca nombres, teléfonos ni emails).

import {
  getSupabaseAdmin,
  isSupabaseConfigured,
  type EventoComportamentalInsert,
  type TipoEvento,
} from "@/lib/supabase/client";

export type EmitirEventoInput = {
  tipo: TipoEvento;
  /** clinica_id (text). Requerido para keying analítico. */
  clinica: string;
  /** paciente_id (text). Opcional (algunos eventos no son por-paciente). */
  paciente?: string | null;
  contexto?: Record<string, unknown>;
  estadoPaciente?: Record<string, unknown>;
  resultadoFinal?: string | null;
  tiempoHastaResultadoSeg?: number | null;
  caminoCompleto?: string[] | null;
};

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inserta un evento comportamental. Async pero resiliente: resuelve siempre
 * (nunca rechaza). Devuelve true si se insertó, false si se descartó/falló.
 */
export async function emitirEventoComportamental(input: EmitirEventoInput): Promise<boolean> {
  if (!input.clinica) {
    // Sin clinica_id no podemos keyear; descartamos en silencio (no es un error).
    return false;
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[eventos] Supabase no configurado; evento '${input.tipo}' descartado.`);
    }
    return false;
  }

  const row: EventoComportamentalInsert = {
    clinica_id: input.clinica,
    paciente_id: input.paciente ?? null,
    tipo_evento: input.tipo,
    contexto: input.contexto ?? {},
    estado_paciente: input.estadoPaciente ?? {},
    resultado_final: input.resultadoFinal ?? null,
    tiempo_hasta_resultado_seg: input.tiempoHastaResultadoSeg ?? null,
    camino_completo: input.caminoCompleto ?? null,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("eventos_comportamentales").insert(row);
      if (!error) return true;
      if (attempt === MAX_RETRIES) {
        console.error(
          `[eventos] insert '${input.tipo}' falló tras ${MAX_RETRIES} intentos: ${error.message}`,
        );
        return false;
      }
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        console.error(`[eventos] insert '${input.tipo}' excepción tras ${MAX_RETRIES} intentos:`, e);
        return false;
      }
    }
    await sleep(attempt * 250); // backoff lineal: 250ms, 500ms
  }
  return false;
}

/**
 * Fire-and-forget: dispara el evento sin esperar ni propagar errores.
 * Usar desde el flujo operacional (creación/edición de citas, etc.).
 */
export function emitirEventoFireAndForget(input: EmitirEventoInput): void {
  void emitirEventoComportamental(input).catch(() => {
    /* emitirEventoComportamental ya no rechaza; este catch es defensa extra */
  });
}
