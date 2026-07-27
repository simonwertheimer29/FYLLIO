// app/lib/leads/leads.ts
// Sprint 8 Bloque B — repositorio de Leads.


/**
 * Sprint 9: el enum Airtable sigue incluyendo "Citados Hoy" como valor
 * legacy; nuevos leads solo usan "Citado" + Fecha_Cita para derivar la
 * columna "Citados Hoy" en el kanban (filtro de visualización).
 * "Convertido" se añade automáticamente vía typecast:true al primer update
 * que lo use (Airtable lo registra la primera vez).
 */
export type LeadEstado =
  | "Nuevo"
  | "Contactado"
  | "Citado"
  | "Citados Hoy"
  | "No Interesado"
  | "Convertido";

export const LEAD_ESTADOS: LeadEstado[] = [
  "Nuevo",
  "Contactado",
  "Citado",
  "Citados Hoy",
  "No Interesado",
  "Convertido",
];

export type LeadTipoVisita = "Primera visita" | "Revisión" | "Urgencia";
// MEJORAS 42 (2026-07-27) — vocabulario de seis valores + el legacy que
// pueda quedar guardado. La definición (etiquetas, si es reactivable) vive en
// lib/leads/motivos, compartida por UI, repo y Copilot.
import type { MotivoLeadAlmacenado } from "./motivos";
export type LeadMotivoNoInteres = MotivoLeadAlmacenado;

/** Sprint 10 B — intenciones IA específicas para leads (distintas de las
 *  de presupuestos porque el funnel es previo a propuesta económica). */
export type LeadIntencion =
  | "Interesado"
  | "Pide más info"
  | "Pregunta precio"
  | "Pide cita"
  | "No interesado"
  | "Sin clasificar";

export type LeadTratamiento =
  | "Implantología"
  | "Ortodoncia"
  | "Ortodoncia Invisible"
  | "Periodoncia"
  | "Endodoncia"
  | "Blanqueamiento"
  | "Corona cerámica"
  | "Empaste"
  | "Limpieza"
  | "Revisión"
  | "Otro";

export type LeadCanal =
  | "Facebook"
  | "Instagram"
  | "Google Ads"
  | "Google Orgánico"
  | "Landing Page"
  | "Visita directa"
  | "Referido"
  | "WhatsApp"
  | "Otro";

export type Lead = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamiento: LeadTratamiento | null;
  canal: LeadCanal | null;
  estado: LeadEstado;
  clinicaId: string | null;
  clinicaNombre?: string;
  fechaCita: string | null;
  /** Sprint 9: hora de cita formato HH:MM (text libre por simplicidad Metadata API). */
  horaCita: string | null;
  /** Sprint 9: doctor asignado al agendar (link Staff). */
  doctorAsignadoId: string | null;
  /** Sprint 9: Primera visita / Revisión / Urgencia. */
  tipoVisita: LeadTipoVisita | null;
  /** Sprint 9: motivo de la transición a "No Interesado". */
  motivoNoInteres: LeadMotivoNoInteres | null;
  /** MEJORAS 37 — cuándo pasó a Convertido / No Interesado. Null = cerrado
   *  antes de que existiera el dato (no se inventan fechas hacia atrás). */
  fechaCierre: string | null;
  /** Sprint 10 B — última intención clasificada por IA (cacheada). */
  intencionDetectada: LeadIntencion | null;
  /** Sprint 10 B — sugerencia IA para responder al último entrante. */
  mensajeSugerido: string | null;
  /** Sprint 10 B — acción operativa recomendada (corta, una línea). */
  accionSugerida: string | null;
  llamado: boolean;
  whatsappEnviados: number;
  ultimaAccion: string | null;
  notas: string | null;
  convertido: boolean;
  pacienteId: string | null;
  /** Sprint 8: coord marca manualmente cuando el paciente se presentó a la cita. */
  asistido: boolean;
  createdAt: string; // ISO — Airtable record createdTime
};

function toLead(rec: any): Lead {
  const f = rec.fields ?? {};
  const clinicaLinks = (f["Clinica"] ?? []) as string[];
  const pacienteLinks = (f["Paciente_ID"] ?? []) as string[];
  const doctorLinks = (f["Doctor_Asignado"] ?? []) as string[];
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    telefono: f["Telefono"] ? String(f["Telefono"]) : null,
    email: f["Email"] ? String(f["Email"]) : null,
    tratamiento: f["Tratamiento_Interes"] ? (String(f["Tratamiento_Interes"]) as LeadTratamiento) : null,
    canal: f["Canal_Captacion"] ? (String(f["Canal_Captacion"]) as LeadCanal) : null,
    estado: (f["Estado"] as LeadEstado) ?? "Nuevo",
    clinicaId: clinicaLinks[0] ?? null,
    fechaCita: f["Fecha_Cita"] ? String(f["Fecha_Cita"]) : null,
    horaCita: f["Hora_Cita"] ? String(f["Hora_Cita"]) : null,
    doctorAsignadoId: doctorLinks[0] ?? null,
    tipoVisita: f["Tipo_Visita"] ? (String(f["Tipo_Visita"]) as LeadTipoVisita) : null,
    motivoNoInteres: f["Motivo_No_Interes"] ? (String(f["Motivo_No_Interes"]) as LeadMotivoNoInteres) : null,
    // La fecha de cierre solo existe en Postgres (MEJORAS 37): no se añadió a
    // Airtable porque esa rama ya no tiene consumidor real (MEJORAS 44).
    fechaCierre: null,
    intencionDetectada: f["Intencion_Detectada"] ? (String(f["Intencion_Detectada"]) as LeadIntencion) : null,
    mensajeSugerido: f["Mensaje_Sugerido"] ? String(f["Mensaje_Sugerido"]) : null,
    accionSugerida: f["Accion_Sugerida"] ? String(f["Accion_Sugerida"]) : null,
    llamado: Boolean(f["Llamado"] ?? false),
    whatsappEnviados: Number(f["WhatsApp_Enviados"] ?? 0),
    ultimaAccion: f["Ultima_Accion"] ? String(f["Ultima_Accion"]) : null,
    notas: f["Notas"] ? String(f["Notas"]) : null,
    convertido: Boolean(f["Convertido_A_Paciente"] ?? false),
    pacienteId: pacienteLinks[0] ?? null,
    asistido: Boolean(f["Asistido"] ?? false),
    createdAt: String(rec._rawJson?.createdTime ?? rec.createdTime ?? ""),
  };
}

export type ListLeadsParams = {
  clinicaIds?: string[]; // [] o undefined = todas
  estado?: LeadEstado;
  search?: string;
  fechaDesde?: string; // ISO date
  fechaHasta?: string;
};

export async function listLeads(params: ListLeadsParams = {}): Promise<Lead[]> {
  const pg = await import("./pg");
  return pg.listLeadsPg(params);
  
}

export async function getLead(id: string): Promise<Lead | null> {
  const pg = await import("./pg");
  return pg.getLeadPg(id);
  
}

/**
 * Leads cuyo Estado está en la lista (filtro server-side, OR de igualdades).
 * Usado por el cron de automatizaciones (trigger lead_inactivo_n_dias).
 */
export async function listLeadsPorEstados(estados: string[]): Promise<Lead[]> {
  const pg = await import("./pg");
  return pg.listLeadsPorEstadosPg(estados);
  
}

/**
 * Match del webhook entrante: lead NO convertido cuyo Telefono (normalizado
 * quitando espacios/+/-) contiene el teléfono buscado. Excluye convertidos
 * para no resucitarlos. Devuelve null si no hay match o si la query falla
 * (el webhook trata ambos igual: mensaje huérfano).
 */
export async function buscarLeadActivoPorTelefono(
  telefonoNormalizado: string,
): Promise<{ id: string; clinicaId?: string } | null> {
  const pg = await import("./pg");
  return pg.buscarLeadActivoPorTelefonoPg(telefonoNormalizado);
  
}

export async function createLead(input: {
  nombre: string;
  telefono?: string;
  email?: string;
  tratamiento?: LeadTratamiento;
  canal?: LeadCanal;
  estado?: LeadEstado;
  clinicaId: string;
  fechaCita?: string;
  notas?: string;
}): Promise<Lead> {
  const pg = await import("./pg");
  return pg.createLeadPg(input);
  
}

export async function updateLead(
  id: string,
  patch: Partial<{
    nombre: string;
    telefono: string | null;
    email: string | null;
    tratamiento: LeadTratamiento | null;
    canal: LeadCanal | null;
    estado: LeadEstado;
    clinicaId: string;
    fechaCita: string | null;
    horaCita: string | null;
    doctorAsignadoId: string | null;
    tipoVisita: LeadTipoVisita | null;
    motivoNoInteres: LeadMotivoNoInteres | null;
    intencionDetectada: LeadIntencion | null;
    mensajeSugerido: string | null;
    accionSugerida: string | null;
    llamado: boolean;
    whatsappEnviados: number;
    ultimaAccion: string | null;
    notas: string | null;
    asistido: boolean;
  }>
): Promise<Lead> {
  const pg = await import("./pg");
  return pg.updateLeadPg(id, patch as Record<string, unknown>);
  
}

/** Añade una entrada con timestamp al campo `Ultima_Accion` (log ligero). */
export async function appendLeadLog(leadId: string, event: string): Promise<void> {
  const pg = await import("./pg");
  return pg.appendLeadLogPg(leadId, event);
  
}

export async function markLeadConvertido(leadId: string, pacienteId: string): Promise<Lead> {
  const pg = await import("./pg");
  return pg.markLeadConvertidoPg(leadId, pacienteId);
  
}
