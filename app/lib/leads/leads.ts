// app/lib/leads/leads.ts
// Sprint 8 Bloque B — repositorio de Leads.

import { base, TABLES, fetchAll } from "../airtable";

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
export type LeadMotivoNoInteres = "Rechazo_Producto" | "No_Asistio";

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
  const recs = await fetchAll(base(TABLES.leads).select({}));
  let leads = recs.map(toLead);

  if (params.clinicaIds && params.clinicaIds.length > 0) {
    const set = new Set(params.clinicaIds);
    leads = leads.filter((l) => l.clinicaId && set.has(l.clinicaId));
  }
  if (params.estado) {
    leads = leads.filter((l) => l.estado === params.estado);
  }
  if (params.search) {
    const q = params.search.toLowerCase().trim();
    if (q) {
      leads = leads.filter(
        (l) =>
          l.nombre.toLowerCase().includes(q) ||
          (l.telefono ?? "").toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q)
      );
    }
  }
  if (params.fechaDesde) {
    leads = leads.filter((l) => l.createdAt >= params.fechaDesde!);
  }
  if (params.fechaHasta) {
    leads = leads.filter((l) => l.createdAt <= params.fechaHasta!);
  }
  return leads;
}

export async function getLead(id: string): Promise<Lead | null> {
  try {
    const rec = await base(TABLES.leads).find(id);
    return toLead(rec);
  } catch {
    return null;
  }
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
  const fields: Record<string, any> = {
    Nombre: input.nombre,
    Estado: input.estado ?? "Nuevo",
    Clinica: [input.clinicaId],
    WhatsApp_Enviados: 0,
    Llamado: false,
    Convertido_A_Paciente: false,
  };
  if (input.telefono) fields["Telefono"] = input.telefono;
  if (input.email) fields["Email"] = input.email;
  if (input.tratamiento) fields["Tratamiento_Interes"] = input.tratamiento;
  if (input.canal) fields["Canal_Captacion"] = input.canal;
  if (input.fechaCita) fields["Fecha_Cita"] = input.fechaCita;
  if (input.notas) fields["Notas"] = input.notas;

  const created = (await base(TABLES.leads).create([{ fields }]))[0]!;
  return toLead(created);
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
  const fields: Record<string, any> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.telefono !== undefined) fields["Telefono"] = patch.telefono ?? "";
  if (patch.email !== undefined) fields["Email"] = patch.email ?? "";
  if (patch.tratamiento !== undefined) fields["Tratamiento_Interes"] = patch.tratamiento ?? null;
  if (patch.canal !== undefined) fields["Canal_Captacion"] = patch.canal ?? null;
  if (patch.estado !== undefined) fields["Estado"] = patch.estado;
  if (patch.clinicaId !== undefined) fields["Clinica"] = [patch.clinicaId];
  if (patch.fechaCita !== undefined) fields["Fecha_Cita"] = patch.fechaCita ?? "";
  if (patch.horaCita !== undefined) fields["Hora_Cita"] = patch.horaCita ?? "";
  if (patch.doctorAsignadoId !== undefined)
    fields["Doctor_Asignado"] = patch.doctorAsignadoId ? [patch.doctorAsignadoId] : [];
  if (patch.tipoVisita !== undefined) fields["Tipo_Visita"] = patch.tipoVisita ?? null;
  if (patch.motivoNoInteres !== undefined) fields["Motivo_No_Interes"] = patch.motivoNoInteres ?? null;
  if (patch.intencionDetectada !== undefined) fields["Intencion_Detectada"] = patch.intencionDetectada ?? null;
  if (patch.mensajeSugerido !== undefined) fields["Mensaje_Sugerido"] = patch.mensajeSugerido ?? "";
  if (patch.accionSugerida !== undefined) fields["Accion_Sugerida"] = patch.accionSugerida ?? "";
  if (patch.llamado !== undefined) fields["Llamado"] = patch.llamado;
  if (patch.whatsappEnviados !== undefined) fields["WhatsApp_Enviados"] = patch.whatsappEnviados;
  if (patch.ultimaAccion !== undefined) fields["Ultima_Accion"] = patch.ultimaAccion ?? "";
  if (patch.notas !== undefined) fields["Notas"] = patch.notas ?? "";
  if (patch.asistido !== undefined) fields["Asistido"] = patch.asistido;

  // typecast: true permite que Airtable cree automáticamente la opción del
  // singleSelect Estado la primera vez que llega "Convertido" (añadido en
  // Sprint 9 sin PATCH de schema — Metadata API no acepta modificaciones
  // de choices sobre un singleSelect existente en este token).
  const updated = (
    await base(TABLES.leads).update([{ id, fields }], { typecast: true })
  )[0]!;
  return toLead(updated);
}

/** Añade una entrada con timestamp al campo `Ultima_Accion` (log ligero). */
export async function appendLeadLog(leadId: string, event: string): Promise<void> {
  try {
    const rec = await base(TABLES.leads).find(leadId);
    const prev = String(rec.fields?.["Ultima_Accion"] ?? "");
    const stamp = new Date().toISOString().replace(".000Z", "Z");
    const line = `[${stamp}] ${event}`;
    const next = prev ? `${prev}\n${line}` : line;
    await base(TABLES.leads).update([{ id: leadId, fields: { Ultima_Accion: next } }]);
  } catch {
    /* silencioso: log sin impacto funcional */
  }
}

export async function markLeadConvertido(leadId: string, pacienteId: string): Promise<Lead> {
  const updated = (
    await base(TABLES.leads).update([
      {
        id: leadId,
        fields: {
          Convertido_A_Paciente: true,
          Paciente_ID: [pacienteId],
        },
      },
    ])
  )[0]!;
  return toLead(updated);
}
