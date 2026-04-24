// app/lib/pacientes/pacientes.ts
// Sprint 8 Bloque C — repositorio de Pacientes central.

import { base, TABLES, fetchAll } from "../airtable";

export type PacienteTratamiento =
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

export type PacienteAceptado = "Si" | "No" | "Pendiente";

export type PacienteCanal =
  | "Facebook"
  | "Instagram"
  | "Google Ads"
  | "Google Orgánico"
  | "Landing Page"
  | "Visita directa"
  | "Referido"
  | "WhatsApp"
  | "Otro";

export type Paciente = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamientos: PacienteTratamiento[];
  doctorLinkId: string | null;
  doctorNombre?: string;
  fechaCita: string | null;
  presupuestoTotal: number | null;
  aceptado: PacienteAceptado | null;
  pagado: number | null;
  pendiente: number | null;
  financiado: number | null;
  notas: string | null;
  canalOrigen: PacienteCanal | null;
  clinicaId: string | null;
  clinicaNombre?: string;
  leadOrigenId: string | null;
  activo: boolean;
  createdAt: string;
};

function toPaciente(rec: any): Paciente {
  const f = rec.fields ?? {};
  const clinicaLinks = (f["Clínica"] ?? []) as string[];
  const doctorLinks = (f["Doctor_Link"] ?? []) as string[];
  const leadLinks = (f["Lead_Origen"] ?? []) as string[];
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    telefono: f["Teléfono"] ? String(f["Teléfono"]) : null,
    email: f["Email"] ? String(f["Email"]) : null,
    tratamientos: (f["Tratamientos"] ?? []) as PacienteTratamiento[],
    doctorLinkId: doctorLinks[0] ?? null,
    fechaCita: f["Fecha_Cita"] ? String(f["Fecha_Cita"]) : null,
    presupuestoTotal: typeof f["Presupuesto_Total"] === "number" ? f["Presupuesto_Total"] : null,
    aceptado: f["Aceptado"] ? (String(f["Aceptado"]) as PacienteAceptado) : null,
    pagado: typeof f["Pagado"] === "number" ? f["Pagado"] : null,
    pendiente: typeof f["Pendiente"] === "number" ? f["Pendiente"] : null,
    financiado: typeof f["Financiado"] === "number" ? f["Financiado"] : null,
    notas: f["Notas"] ? String(f["Notas"]) : null,
    canalOrigen: f["Canal_Origen"] ? (String(f["Canal_Origen"]) as PacienteCanal) : null,
    clinicaId: clinicaLinks[0] ?? null,
    leadOrigenId: leadLinks[0] ?? null,
    activo: Boolean(f["Activo"] ?? true),
    createdAt: String(rec.createdTime ?? ""),
  };
}

export type ListPacientesParams = {
  clinicaIds?: string[];
  search?: string;
  aceptado?: PacienteAceptado;
  fechaDesde?: string;
  fechaHasta?: string;
};

export async function listPacientes(params: ListPacientesParams = {}): Promise<Paciente[]> {
  const recs = await fetchAll(base(TABLES.patients).select({}));
  let pacientes = recs.map(toPaciente);

  if (params.clinicaIds && params.clinicaIds.length > 0) {
    const set = new Set(params.clinicaIds);
    pacientes = pacientes.filter((p) => p.clinicaId && set.has(p.clinicaId));
  }
  if (params.aceptado) {
    pacientes = pacientes.filter((p) => p.aceptado === params.aceptado);
  }
  if (params.search) {
    const q = params.search.toLowerCase().trim();
    if (q) {
      pacientes = pacientes.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.telefono ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q)
      );
    }
  }
  if (params.fechaDesde) {
    pacientes = pacientes.filter((p) => p.createdAt >= params.fechaDesde!);
  }
  if (params.fechaHasta) {
    pacientes = pacientes.filter((p) => p.createdAt <= params.fechaHasta!);
  }
  return pacientes;
}

export async function getPaciente(id: string): Promise<Paciente | null> {
  try {
    const rec = await base(TABLES.patients).find(id);
    return toPaciente(rec);
  } catch {
    return null;
  }
}

export async function createPaciente(input: {
  nombre: string;
  telefono?: string;
  email?: string;
  clinicaId: string;
  tratamientos?: PacienteTratamiento[];
  doctorLinkId?: string;
  fechaCita?: string;
  presupuestoTotal?: number;
  aceptado?: PacienteAceptado;
  pagado?: number;
  financiado?: number;
  notas?: string;
  canalOrigen?: PacienteCanal;
  leadOrigenId?: string;
}): Promise<Paciente> {
  const fields: Record<string, any> = {
    Nombre: input.nombre,
    Clínica: [input.clinicaId],
    Activo: true,
    "Canal preferido": "Whatsapp",
    "Consentimiento Whatsapp": true,
  };
  if (input.telefono) fields["Teléfono"] = input.telefono;
  if (input.email) fields["Email"] = input.email;
  if (input.tratamientos?.length) fields["Tratamientos"] = input.tratamientos;
  if (input.doctorLinkId) fields["Doctor_Link"] = [input.doctorLinkId];
  if (input.fechaCita) fields["Fecha_Cita"] = input.fechaCita;
  if (typeof input.presupuestoTotal === "number")
    fields["Presupuesto_Total"] = input.presupuestoTotal;
  if (input.aceptado) fields["Aceptado"] = input.aceptado;
  if (typeof input.pagado === "number") {
    fields["Pagado"] = input.pagado;
    if (typeof input.presupuestoTotal === "number") {
      fields["Pendiente"] = Math.max(0, input.presupuestoTotal - input.pagado);
    }
  }
  if (typeof input.financiado === "number") fields["Financiado"] = input.financiado;
  if (input.notas) fields["Notas"] = input.notas;
  if (input.canalOrigen) fields["Canal_Origen"] = input.canalOrigen;
  if (input.leadOrigenId) fields["Lead_Origen"] = [input.leadOrigenId];

  const created = (await base(TABLES.patients).create([{ fields }]))[0]!;
  return toPaciente(created);
}

export async function updatePaciente(
  id: string,
  patch: Partial<{
    nombre: string;
    telefono: string | null;
    email: string | null;
    tratamientos: PacienteTratamiento[];
    doctorLinkId: string | null;
    fechaCita: string | null;
    presupuestoTotal: number | null;
    aceptado: PacienteAceptado | null;
    pagado: number | null;
    financiado: number | null;
    notas: string | null;
    canalOrigen: PacienteCanal | null;
    activo: boolean;
  }>
): Promise<Paciente> {
  const fields: Record<string, any> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.telefono !== undefined) fields["Teléfono"] = patch.telefono ?? "";
  if (patch.email !== undefined) fields["Email"] = patch.email ?? "";
  if (patch.tratamientos !== undefined) fields["Tratamientos"] = patch.tratamientos;
  if (patch.doctorLinkId !== undefined)
    fields["Doctor_Link"] = patch.doctorLinkId ? [patch.doctorLinkId] : [];
  if (patch.fechaCita !== undefined) fields["Fecha_Cita"] = patch.fechaCita ?? "";
  if (patch.presupuestoTotal !== undefined)
    fields["Presupuesto_Total"] = patch.presupuestoTotal ?? null;
  if (patch.aceptado !== undefined) fields["Aceptado"] = patch.aceptado ?? null;
  if (patch.pagado !== undefined) fields["Pagado"] = patch.pagado ?? null;
  if (patch.financiado !== undefined) fields["Financiado"] = patch.financiado ?? null;
  if (patch.notas !== undefined) fields["Notas"] = patch.notas ?? "";
  if (patch.canalOrigen !== undefined) fields["Canal_Origen"] = patch.canalOrigen ?? null;
  if (patch.activo !== undefined) fields["Activo"] = patch.activo;

  // Recalcular Pendiente si cambia Presupuesto o Pagado.
  if (patch.presupuestoTotal !== undefined || patch.pagado !== undefined) {
    const current = await getPaciente(id);
    const total = patch.presupuestoTotal ?? current?.presupuestoTotal ?? null;
    const pagado = patch.pagado ?? current?.pagado ?? null;
    if (typeof total === "number" && typeof pagado === "number") {
      fields["Pendiente"] = Math.max(0, total - pagado);
    }
  }

  const updated = (await base(TABLES.patients).update([{ id, fields }]))[0]!;
  return toPaciente(updated);
}

export async function deletePaciente(id: string): Promise<void> {
  await base(TABLES.patients).destroy([id]);
}
