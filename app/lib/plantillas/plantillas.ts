// app/lib/plantillas/plantillas.ts
//
// Sprint 14b Bloque 4 — repositorio de Plantillas_Mensaje + helpers
// de render.

import { baseCentral, base, TABLES, fetchAll } from "../airtable";
import { getPaciente } from "../pacientes/pacientes";
import { getOpcionEscalar } from "../configuraciones/configuraciones";

export type PlantillaCategoria =
  | "cobranza"
  | "lead_seguimiento"
  | "cita_recordatorio";

export type Plantilla = {
  id: string;
  nombre: string;
  categoria: PlantillaCategoria;
  contenido: string;
  variablesDetectadas: string[];
  clinicaId: string | null;
  activa: boolean;
  createdAt: string;
};

function toPlantilla(rec: any): Plantilla {
  const f = rec.fields ?? {};
  const links = (f["Clinica_Link"] ?? []) as string[];
  const varsRaw = String(f["Variables_Detectadas"] ?? "");
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    categoria: (String(f["Categoria"] ?? "lead_seguimiento") as PlantillaCategoria),
    contenido: String(f["Contenido"] ?? ""),
    variablesDetectadas: varsRaw
      ? varsRaw.split(",").map((v) => v.trim()).filter(Boolean)
      : [],
    clinicaId: links[0] ?? null,
    activa: Boolean(f["Activa"] ?? true),
    createdAt: String(
      f["Fecha_creacion"] ?? rec._rawJson?.createdTime ?? rec.createdTime ?? "",
    ),
  };
}

/** Lista TODAS las plantillas (panel admin las cruza). */
export async function listPlantillas(): Promise<Plantilla[]> {
  const recs = await fetchAll(base(TABLES.plantillasMensaje as any).select({}));
  return recs.map(toPlantilla);
}

/**
 * Devuelve plantillas activas para (clinicaId, categoria) con la regla
 * de fallback simétrica a Configuraciones_Clinica: si la clinica tiene
 * ≥1 propia activa, devolvemos las suyas; si no, las globales activas.
 *
 * Diferencia con configuraciones: si la clinica tiene una propia con el
 * MISMO Nombre que una global, la propia *sustituye* a la global en la
 * lista devuelta (override por nombre). Permite editar la copia
 * 'recordatorio_senal' de una clinica sin perder la fallback global.
 */
export async function getPlantillasActivas(args: {
  clinicaId: string | null;
  categoria: PlantillaCategoria;
}): Promise<Plantilla[]> {
  const all = await listPlantillas();
  const sameCat = all.filter((p) => p.categoria === args.categoria && p.activa);
  if (args.clinicaId) {
    const propias = sameCat.filter((p) => p.clinicaId === args.clinicaId);
    if (propias.length > 0) {
      // Mezclamos propias + globales que la clinica NO ha sobrescrito
      // por nombre. Asi la coordinadora ve los 3 defaults aunque solo
      // haya editado uno.
      const nombresPropios = new Set(propias.map((p) => p.nombre));
      const globalesNoSobrescritas = sameCat.filter(
        (p) => p.clinicaId === null && !nombresPropios.has(p.nombre),
      );
      return [...propias, ...globalesNoSobrescritas].sort((a, b) =>
        a.nombre.localeCompare(b.nombre),
      );
    }
  }
  return sameCat
    .filter((p) => p.clinicaId === null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function getPlantillaById(id: string): Promise<Plantilla | null> {
  try {
    const rec = await base(TABLES.plantillasMensaje as any).find(id);
    return toPlantilla(rec);
  } catch {
    return null;
  }
}

/** Extrae nombres de variables {{var}} del contenido. Util para
 *  Variables_Detectadas + validacion de UI. */
export function extractVariables(contenido: string): string[] {
  const re = /\{\{([a-zA-Z_]+)\}\}/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido)) !== null) found.add(m[1]!);
  return Array.from(found).sort();
}

export async function createPlantilla(input: {
  nombre: string;
  categoria: PlantillaCategoria;
  contenido: string;
  clinicaId: string | null;
  tipo?: string; // legacy 'Tipo' (Primer contacto, Recordatorio, ...)
}): Promise<Plantilla> {
  const fields: Record<string, unknown> = {
    Nombre: input.nombre,
    Tipo: input.tipo ?? "Recordatorio",
    Categoria: input.categoria,
    Contenido: input.contenido,
    Variables_Detectadas: extractVariables(input.contenido).join(", "),
    Activa: true,
    Fecha_creacion: new Date().toISOString(),
  };
  if (input.clinicaId) fields["Clinica_Link"] = [input.clinicaId];
  const created = (
    await (base(TABLES.plantillasMensaje as any) as any).create(
      [{ fields }],
      { typecast: true },
    )
  )[0]!;
  return toPlantilla(created);
}

export async function updatePlantilla(
  id: string,
  patch: Partial<{
    nombre: string;
    categoria: PlantillaCategoria;
    contenido: string;
    activa: boolean;
  }>,
): Promise<Plantilla> {
  const fields: Record<string, unknown> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.categoria !== undefined) fields["Categoria"] = patch.categoria;
  if (patch.contenido !== undefined) {
    fields["Contenido"] = patch.contenido;
    fields["Variables_Detectadas"] = extractVariables(patch.contenido).join(", ");
  }
  if (patch.activa !== undefined) fields["Activa"] = patch.activa;
  const updated = (
    await (base(TABLES.plantillasMensaje as any) as any).update(
      [{ id, fields }],
      { typecast: true },
    )
  )[0]!;
  return toPlantilla(updated);
}

// ─── Render ────────────────────────────────────────────────────────────

export type RenderOverrides = {
  /** Sample data para preview en el panel admin (sin tocar Airtable). */
  nombre?: string;
  importe?: number;
  tratamiento?: string;
  nombre_doctor?: string;
  nombre_clinica?: string;
  fecha_aceptado?: string;
  plazo_dias?: number;
  dias_vencido?: number;
};

/**
 * Sustituye {{vars}} de la plantilla con datos del paciente real.
 * Si overrides se pasa, los valores en overrides ganan sobre los
 * derivados (uso para preview en UI: enseñar el render con un
 * paciente ejemplo sin queries pesadas).
 *
 * Variables soportadas:
 *   {{nombre}}            paciente.nombre
 *   {{importe}}           presupuesto firmado o sample (formato 1.234,56€ via overrides)
 *   {{tratamiento}}       paciente.tratamientos.join(", ")
 *   {{nombre_doctor}}     Staff.Nombre del paciente.doctorLinkId
 *   {{nombre_clinica}}    Clinica.Nombre del paciente.clinicaId
 *   {{fecha_aceptado}}    Presupuestos.Fecha_Aceptado del primer
 *                         presupuesto ACEPTADO (dd/MM/yyyy)
 *   {{plazo_dias}}        Configuraciones_Clinica.Plazos_Liquidacion
 *                         (default 90)
 *   {{dias_vencido}}      max(0, today - (fecha_aceptado + plazo_dias))
 *
 * Si una variable no se puede resolver, queda como "—" (no rompe
 * mensajes; la coordinadora ve cuál falta).
 */
export async function renderizarPlantilla(args: {
  plantillaId: string;
  pacienteId: string;
  overrides?: RenderOverrides;
}): Promise<{ texto: string; valoresUsados: Record<string, string> }> {
  const plantilla = await getPlantillaById(args.plantillaId);
  if (!plantilla) throw new Error(`Plantilla ${args.plantillaId} no encontrada`);
  const valores = await resolveValoresParaPaciente(args.pacienteId, args.overrides);
  return aplicarVariables(plantilla.contenido, valores);
}

/**
 * Variante para preview en UI: no requiere plantilla en Airtable,
 * acepta el contenido directo.
 */
export async function previewContenido(args: {
  contenido: string;
  pacienteId: string;
  overrides?: RenderOverrides;
}): Promise<{ texto: string; valoresUsados: Record<string, string> }> {
  const valores = await resolveValoresParaPaciente(args.pacienteId, args.overrides);
  return aplicarVariables(args.contenido, valores);
}

function aplicarVariables(
  contenido: string,
  valores: Record<string, string>,
): { texto: string; valoresUsados: Record<string, string> } {
  const usados: Record<string, string> = {};
  const texto = contenido.replace(/\{\{([a-zA-Z_]+)\}\}/g, (_, key: string) => {
    const v = valores[key] ?? "—";
    usados[key] = v;
    return v;
  });
  return { texto, valoresUsados: usados };
}

async function resolveValoresParaPaciente(
  pacienteId: string,
  overrides?: RenderOverrides,
): Promise<Record<string, string>> {
  const paciente = await getPaciente(pacienteId);
  if (!paciente) {
    return overridesToStrings(overrides);
  }

  // Doctor + clinica (1 query cada uno, in parallel).
  const [doctorNombre, clinicaNombre] = await Promise.all([
    paciente.doctorLinkId ? loadStaffNombre(paciente.doctorLinkId) : Promise.resolve(null),
    paciente.clinicaId ? loadClinicaNombre(paciente.clinicaId) : Promise.resolve(null),
  ]);

  // Presupuesto firmado más reciente (primer ACEPTADO con Fecha_Aceptado).
  const presupuestoFirmado = await loadPresupuestoFirmado(pacienteId);
  const fechaAceptadoIso = presupuestoFirmado?.fechaAceptado ?? null;

  // Plazo liquidacion (de config clinica con fallback global 90).
  const plazoDias = await getOpcionEscalar({
    clinicaId: paciente.clinicaId,
    categoria: "Plazos_Liquidacion",
    defaultValue: 90,
  });

  // dias_vencido = today - (fecha_aceptado + plazo_dias). Si <0, 0.
  let diasVencido: number | null = null;
  if (fechaAceptadoIso) {
    const aceptado = new Date(fechaAceptadoIso);
    const vence = new Date(aceptado.getTime() + plazoDias * 24 * 60 * 60 * 1000);
    diasVencido = Math.max(
      0,
      Math.floor((Date.now() - vence.getTime()) / (24 * 60 * 60 * 1000)),
    );
  }

  const importeRaw = paciente.presupuestoTotal ?? presupuestoFirmado?.importe ?? null;

  const base: Record<string, string> = {
    nombre: paciente.nombre || "",
    importe: importeRaw != null ? fmtImporteEs(importeRaw) : "",
    tratamiento: (paciente.tratamientos ?? []).join(", "),
    nombre_doctor: doctorNombre ?? "",
    nombre_clinica: clinicaNombre ?? "",
    fecha_aceptado: fechaAceptadoIso ? fmtFechaEs(fechaAceptadoIso) : "",
    plazo_dias: String(plazoDias),
    dias_vencido: diasVencido != null ? String(diasVencido) : "",
  };

  // Overrides ganan sobre derivados.
  return { ...base, ...overridesToStrings(overrides) };
}

function overridesToStrings(o?: RenderOverrides): Record<string, string> {
  if (!o) return {};
  const out: Record<string, string> = {};
  if (o.nombre !== undefined) out.nombre = o.nombre;
  if (o.importe !== undefined) out.importe = fmtImporteEs(o.importe);
  if (o.tratamiento !== undefined) out.tratamiento = o.tratamiento;
  if (o.nombre_doctor !== undefined) out.nombre_doctor = o.nombre_doctor;
  if (o.nombre_clinica !== undefined) out.nombre_clinica = o.nombre_clinica;
  if (o.fecha_aceptado !== undefined) out.fecha_aceptado = o.fecha_aceptado;
  if (o.plazo_dias !== undefined) out.plazo_dias = String(o.plazo_dias);
  if (o.dias_vencido !== undefined) out.dias_vencido = String(o.dias_vencido);
  return out;
}

// ─── Helpers internos ──────────────────────────────────────────────────

async function loadStaffNombre(staffId: string): Promise<string | null> {
  try {
    // FASE 1 migración: lectura via repo del dominio Agenda.
    const { getStaffNombrePorId } = await import("../scheduler/repo/staffRepo");
    return (await getStaffNombrePorId(staffId)) || null;
  } catch {
    return null;
  }
}

async function loadClinicaNombre(clinicaId: string): Promise<string | null> {
  try {
    const rec = await baseCentral(TABLES.clinics as any).find(clinicaId);
    return String((rec.fields as any)?.["Nombre"] ?? "") || null;
  } catch {
    return null;
  }
}

async function loadPresupuestoFirmado(
  pacienteId: string,
): Promise<{ importe: number | null; fechaAceptado: string | null } | null> {
  // Mismo patrón load+filter-JS que en Bloque 1.5 (Presupuestos no
  // tiene Paciente_RecordId todavia; deuda Sprint 14b/15).
  try {
    const recs = await fetchAll(
      base(TABLES.presupuestos as any).select({
        fields: ["Paciente", "Estado", "Importe", "Fecha_Aceptado"],
      }),
    );
    const propios = recs.filter((r) => {
      const links = ((r.fields as any)?.["Paciente"] ?? []) as string[];
      return links[0] === pacienteId;
    });
    const aceptado = propios.find(
      (r) => String(((r.fields as any) ?? {})["Estado"] ?? "") === "ACEPTADO",
    );
    if (!aceptado) return null;
    const f = aceptado.fields as any;
    return {
      importe: f["Importe"] != null ? Number(f["Importe"]) : null,
      fechaAceptado: f["Fecha_Aceptado"]
        ? String(f["Fecha_Aceptado"]).slice(0, 10)
        : null,
    };
  } catch {
    return null;
  }
}

function fmtImporteEs(n: number): string {
  // Importe en mensajes WA: si es entero, sin decimales (4.200€ se ve
  // mejor que 4.200,00€). Si tiene fracción, 2 decimales fijos.
  const isInt = Number.isFinite(n) && Math.round(n) === n;
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
}

function fmtFechaEs(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
