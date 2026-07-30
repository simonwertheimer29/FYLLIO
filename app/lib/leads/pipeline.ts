// Una sola definición de "leads en el pipeline" (decisión 2026-07-23).
//
// Pipeline = leads ACCIONABLES: Nuevo + Contactado + Citado (+ "Citados Hoy",
// que es la misma etapa Citado con la cita hoy — columna derivada del tablero).
// Convertido salió del embudo ganado y No Interesado salió perdido: ninguno
// cuenta como "en el pipeline".
//
// Regla dura: el número de una cabecera debe cuadrar con las tarjetas que el
// usuario ve. Si el tablero muestra la columna de No Interesado, la cabecera
// DESGLOSA ("23 activos · 6 no interesados") en vez de dar un total que no
// corresponde a ninguna suma visible. Antes de esto había tres definiciones
// (cabecera contaba todo, Red excluía solo No Interesado, el tablero mostraba
// otra cosa) y los tres números eran distintos.
//
// Módulo PURO (sin datos ni Airtable/PG): lo consumen componentes cliente.

import { casoVisibleConRango, type RangoKanban } from "../../components/shared/RangoTemporal";

export const ESTADOS_LEAD_ACTIVOS = [
  "Nuevo",
  "Contactado",
  "Citado",
  "Citados Hoy",
] as const;

export function esLeadActivo(estado: string): boolean {
  return (ESTADOS_LEAD_ACTIVOS as readonly string[]).includes(estado);
}

/**
 * Fecha del HITO de un lead, la que decide si entra en el rango: cierre para los
 * cerrados (MEJORAS 37 — antes se usaba la actividad como proxy y un lead
 * cerrado sin mensajes no envejecía nunca), última actividad para los vivos,
 * alta si no hay nada. Sin fecha conocida el lead se MUESTRA.
 */
export function fechaDeRangoLead(l: {
  fechaCierre?: string | null;
  createdAt?: string | null;
}, ultimaActividad?: string | null): string | null {
  return (l.fechaCierre ?? ultimaActividad ?? l.createdAt)?.slice(0, 10) ?? null;
}

/**
 * ¿Se ve este lead con el rango elegido? Gemelo exacto de `seVeConRango` de
 * presupuestos, y con la MISMA regla: la comparte `casoVisibleConRango` — el
 * rango acota lo cerrado (Convertido, No Interesado) y no esconde nunca un lead
 * activo, porque un lead vivo es trabajo pendiente independientemente de cuándo
 * se le tocó por última vez.
 *
 * Estaba atenuado aquí por cómo se eligió el hito —última ACTIVIDAD, no fecha de
 * alta, así que un lead con conversación reciente nunca desaparecía— pero de 31
 * leads activos el rango por defecto enseñaba 26, y los 5 que escondía eran los
 * que llevaban más tiempo sin actividad: los que hay que rescatar (MEJORAS 76).
 */
export function seVeLeadConRango(
  l: { estado: string; fechaCierre?: string | null; createdAt?: string | null },
  rango: RangoKanban,
  ultimaActividad?: string | null,
): boolean {
  return casoVisibleConRango(rango, {
    cerrado: !esLeadActivo(l.estado),
    fechaHito: fechaDeRangoLead(l, ultimaActividad),
  });
}

export type PipelineLeads = {
  /** En el pipeline: Nuevo + Contactado + Citado + Citados Hoy. */
  activos: number;
  noInteresados: number;
  convertidos: number;
  total: number;
};

export function contarPipeline(leads: ReadonlyArray<{ estado: string }>): PipelineLeads {
  let activos = 0;
  let noInteresados = 0;
  let convertidos = 0;
  for (const l of leads) {
    if (esLeadActivo(l.estado)) activos++;
    else if (l.estado === "No Interesado") noInteresados++;
    else if (l.estado === "Convertido") convertidos++;
  }
  return { activos, noInteresados, convertidos, total: leads.length };
}

/** Texto de cabecera que cuadra con el tablero: desglosa si hay no interesados. */
export function textoPipeline(p: PipelineLeads): string {
  const activos = `${p.activos} lead${p.activos === 1 ? "" : "s"} activo${p.activos === 1 ? "" : "s"}`;
  if (p.noInteresados === 0) return activos;
  return `${activos} · ${p.noInteresados} no interesado${p.noInteresados === 1 ? "" : "s"}`;
}
