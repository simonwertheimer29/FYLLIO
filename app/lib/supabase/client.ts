// app/lib/supabase/client.ts
// Sprint 18 Bloque 2 — cliente Supabase server-side (service role) + tipos.
//
// El acceso a Supabase en Sprint 18 es 100% server-side con la SERVICE ROLE key
// (bypassea RLS). NUNCA exponer esta key al cliente. Inicialización lazy: la env
// se lee al primer uso (igual que app/lib/airtable.ts) para que los scripts que
// cargan dotenv antes de usar el cliente funcionen.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ----------------------------------------------------------------------------
// Tipos de las tablas (espejo de app/scripts/sprint18-bloque1-supabase.sql)
// ----------------------------------------------------------------------------

export type TipoEvento =
  | "cita_creada"
  | "cita_confirmada"
  | "cita_cancelada"
  | "cita_no_show"
  | "cita_asistio"
  | "lead_creado"
  | "lead_contactado"
  | "lead_respondio"
  | "presupuesto_presentado"
  | "presupuesto_aceptado"
  | "presupuesto_rechazado"
  | "mensaje_enviado"
  | "mensaje_recibido"
  | "llamada_iniciada"
  | "llamada_completada"
  | "accion_cerrada";

export type RiesgoNivel = "bajo" | "medio" | "alto";

/** Un factor ponderado del predictor (se guarda en factores_no_show.factores). */
export type FactorPonderado = {
  factor: string;
  peso: number;
  valor: string | number | boolean | null;
};

export type EventoComportamentalRow = {
  id: string;
  clinica_id: string;
  paciente_id: string | null;
  timestamp: string;
  tipo_evento: TipoEvento;
  contexto: Record<string, unknown>;
  estado_paciente: Record<string, unknown>;
  resultado_final: string | null;
  tiempo_hasta_resultado_seg: number | null;
  camino_completo: string[] | null;
};

export type EventoComportamentalInsert = {
  clinica_id: string;
  paciente_id?: string | null;
  tipo_evento: TipoEvento;
  contexto?: Record<string, unknown>;
  estado_paciente?: Record<string, unknown>;
  resultado_final?: string | null;
  tiempo_hasta_resultado_seg?: number | null;
  camino_completo?: string[] | null;
  timestamp?: string;
};

export type FactorNoShowRow = {
  id: string;
  cita_id: string;
  paciente_id: string | null;
  clinica_id: string;
  riesgo_score: number;
  riesgo_nivel: RiesgoNivel;
  factores: FactorPonderado[];
  accion_recomendada: string | null;
  evaluado_at: string;
  resultado_real: string | null;
  prediccion_correcta: boolean | null;
};

export type FactorNoShowInsert = {
  cita_id: string;
  paciente_id?: string | null;
  clinica_id: string;
  riesgo_score: number;
  riesgo_nivel: RiesgoNivel;
  factores: FactorPonderado[];
  accion_recomendada?: string | null;
  evaluado_at?: string;
  resultado_real?: string | null;
  prediccion_correcta?: boolean | null;
};

// ----------------------------------------------------------------------------
// Cliente
// ----------------------------------------------------------------------------

let _admin: SupabaseClient | null = null;

/** True si las env vars de Supabase están presentes. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Cliente admin (service role). Lanza si faltan env vars — usalo solo donde ya
 * verificaste isSupabaseConfigured() o donde un fallo es aceptable (el emitter
 * captura el error y no bloquea el flujo principal).
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Missing Supabase env vars. SUPABASE_URL=${!!url} SUPABASE_SERVICE_ROLE_KEY=${!!key}`,
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
