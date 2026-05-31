// app/lib/no-shows/config.ts
// Sprint 18 Bloque 8 — configuración del Motor de No-shows.
//
// Se persiste en Configuraciones_Clinica con Categoria="Motor_NoShows" y
// Valor=JSON (mismo patrón que horario_laboral / Llamadas_IA). Fallback a
// global (Clinica_Link vacío) y, si no hay nada, a los defaults del producto.

import { base, TABLES, fetchAll } from "@/lib/airtable";

export const MOTOR_NO_SHOWS_CATEGORIA = "Motor_NoShows";

export type MotorNoShowsConfig = {
  /** Predicción de riesgo activa (evaluación + persistencia). */
  activarPrediccion: boolean;
  /** Programar llamada IA automática para riesgo alto. */
  llamadaIaAuto: boolean;
  /** Envío automático de plantillas extra (medio/alto riesgo). */
  plantillasExtraAuto: boolean;
  /** Umbral de score por encima del cual una cita es riesgo alto (0-100). */
  umbralRiesgoAlto: number;
};

export const MOTOR_NO_SHOWS_DEFAULT: MotorNoShowsConfig = {
  activarPrediccion: true,
  llamadaIaAuto: false,
  plantillasExtraAuto: true,
  umbralRiesgoAlto: 60,
};

function parseConfig(valor: string): MotorNoShowsConfig {
  try {
    const parsed = JSON.parse(valor) as Partial<MotorNoShowsConfig>;
    return {
      activarPrediccion:
        typeof parsed.activarPrediccion === "boolean"
          ? parsed.activarPrediccion
          : MOTOR_NO_SHOWS_DEFAULT.activarPrediccion,
      llamadaIaAuto:
        typeof parsed.llamadaIaAuto === "boolean"
          ? parsed.llamadaIaAuto
          : MOTOR_NO_SHOWS_DEFAULT.llamadaIaAuto,
      plantillasExtraAuto:
        typeof parsed.plantillasExtraAuto === "boolean"
          ? parsed.plantillasExtraAuto
          : MOTOR_NO_SHOWS_DEFAULT.plantillasExtraAuto,
      umbralRiesgoAlto:
        typeof parsed.umbralRiesgoAlto === "number" && Number.isFinite(parsed.umbralRiesgoAlto)
          ? Math.max(0, Math.min(100, parsed.umbralRiesgoAlto))
          : MOTOR_NO_SHOWS_DEFAULT.umbralRiesgoAlto,
    };
  } catch {
    return { ...MOTOR_NO_SHOWS_DEFAULT };
  }
}

/** Busca el record (clinica o global) de la config Motor_NoShows. */
async function findConfigRecord(clinicaId: string | null): Promise<any | null> {
  const recs = await fetchAll(
    base(TABLES.configuracionesClinica).select({
      filterByFormula: `{Categoria}="${MOTOR_NO_SHOWS_CATEGORIA}"`,
    }),
  );
  if (clinicaId) {
    const propia = recs.find((r: any) => {
      const links = (r.fields?.["Clinica_Link"] ?? []) as string[];
      return links.includes(clinicaId);
    });
    if (propia) return propia;
  }
  // Fallback global: sin Clinica_Link.
  return (
    recs.find((r: any) => {
      const links = (r.fields?.["Clinica_Link"] ?? []) as string[];
      return links.length === 0;
    }) ?? null
  );
}

/** Lee la config efectiva (clinica → global → defaults). Nunca lanza. */
export async function getMotorConfig(clinicaId: string | null): Promise<MotorNoShowsConfig> {
  try {
    const rec = await findConfigRecord(clinicaId);
    if (!rec) return { ...MOTOR_NO_SHOWS_DEFAULT };
    return parseConfig(String(rec.fields?.["Valor"] ?? ""));
  } catch (e) {
    console.error("[no-shows config] getMotorConfig:", e);
    return { ...MOTOR_NO_SHOWS_DEFAULT };
  }
}

/**
 * Persiste la config (upsert por clinica/global). Devuelve la config resultante.
 * clinicaId null = global.
 */
export async function setMotorConfig(
  clinicaId: string | null,
  patch: Partial<MotorNoShowsConfig>,
): Promise<MotorNoShowsConfig> {
  const actual = await getMotorConfig(clinicaId);
  const next: MotorNoShowsConfig = {
    activarPrediccion: patch.activarPrediccion ?? actual.activarPrediccion,
    llamadaIaAuto: patch.llamadaIaAuto ?? actual.llamadaIaAuto,
    plantillasExtraAuto: patch.plantillasExtraAuto ?? actual.plantillasExtraAuto,
    umbralRiesgoAlto:
      patch.umbralRiesgoAlto !== undefined
        ? Math.max(0, Math.min(100, patch.umbralRiesgoAlto))
        : actual.umbralRiesgoAlto,
  };

  const valor = JSON.stringify(next);
  const existing = await findConfigRecord(clinicaId);
  // Solo actualizamos el record si es del scope correcto (no pisar global con clinica).
  const existingIsScope = existing
    ? clinicaId
      ? ((existing.fields?.["Clinica_Link"] ?? []) as string[]).includes(clinicaId)
      : ((existing.fields?.["Clinica_Link"] ?? []) as string[]).length === 0
    : false;

  if (existing && existingIsScope) {
    await base(TABLES.configuracionesClinica).update([
      { id: existing.id, fields: { Valor: valor } as any },
    ]);
  } else {
    const fields: Record<string, unknown> = {
      Resumen: `${MOTOR_NO_SHOWS_CATEGORIA} · ${clinicaId ? "clinica" : "global"}`,
      Categoria: MOTOR_NO_SHOWS_CATEGORIA,
      Valor: valor,
      Activo: true,
      Created_At: new Date().toISOString(),
    };
    if (clinicaId) fields["Clinica_Link"] = [clinicaId];
    await base(TABLES.configuracionesClinica).create([{ fields } as any], { typecast: true });
  }
  return next;
}
