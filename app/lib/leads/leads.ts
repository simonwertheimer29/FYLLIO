// app/lib/leads/leads.ts
// Sprint 8 Bloque B — repositorio de Leads.

import { base, TABLES, fetchAll } from "../airtable";

export type LeadEstado = "Nuevo" | "Contactado" | "Citado" | "Citados Hoy" | "No Interesado";
export const LEAD_ESTADOS: LeadEstado[] = [
  "Nuevo",
  "Contactado",
  "Citado",
  "Citados Hoy",
  "No Interesado",
];

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
    llamado: Boolean(f["Llamado"] ?? false),
    whatsappEnviados: Number(f["WhatsApp_Enviados"] ?? 0),
    ultimaAccion: f["Ultima_Accion"] ? String(f["Ultima_Accion"]) : null,
    notas: f["Notas"] ? String(f["Notas"]) : null,
    convertido: Boolean(f["Convertido_A_Paciente"] ?? false),
    pacienteId: pacienteLinks[0] ?? null,
    asistido: Boolean(f["Asistido"] ?? false),
    createdAt: String(rec.createdTime ?? ""),
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
  if (patch.llamado !== undefined) fields["Llamado"] = patch.llamado;
  if (patch.whatsappEnviados !== undefined) fields["WhatsApp_Enviados"] = patch.whatsappEnviados;
  if (patch.ultimaAccion !== undefined) fields["Ultima_Accion"] = patch.ultimaAccion ?? "";
  if (patch.notas !== undefined) fields["Notas"] = patch.notas ?? "";
  if (patch.asistido !== undefined) fields["Asistido"] = patch.asistido;

  const updated = (await base(TABLES.leads).update([{ id, fields }]))[0]!;
  return toLead(updated);
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
