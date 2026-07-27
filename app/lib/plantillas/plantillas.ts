// app/lib/plantillas/plantillas.ts
//
// Sprint 14b Bloque 4 — repositorio de Plantillas_Mensaje + helpers
// de render.

import { selectPresupuestosRaw } from "../presupuestos/repo";
import { getPaciente } from "../pacientes/pacientes";
import { getOpcionEscalar } from "../configuraciones/configuraciones";
import { finanzasDePaciente } from "../finanzas-paciente";

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
  const pg = await import("./plantillas-pg");
  return pg.listPlantillasPg();
  
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
  const pg = await import("./plantillas-pg");
  return pg.getPlantillaByIdPg(id);
  
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
  const pg = await import("./plantillas-pg");
  return pg.createPlantillaPg(input);
  
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
  const pg = await import("./plantillas-pg");
  return pg.updatePlantillaPg(id, patch);
  
}

// ─── Render ────────────────────────────────────────────────────────────

export type RenderOverrides = {
  /** Sample data para preview en el panel admin (sin tocar Airtable). */
  nombre?: string;
  importe?: number;
  pendiente?: number;
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
 *   {{importe}}           Σ presupuestos ACEPTADO (formato 1.234,56)
 *   {{pendiente}}         importe − pagos reales (MEJORAS nº 32) — la cifra
 *                         que se RECLAMA en un recordatorio de cobro; deriva
 *                         de finanzasDePaciente (la lib compartida), nunca
 *                         cálculo propio
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

  // Doctor + clinica + dinero + fecha de aceptación, en paralelo. El dinero
  // sale de finanzasDePaciente — la MISMA lib que la ficha y el módulo
  // Cobros (firmado = Σ ACEPTADO, pendiente = firmado − pagos reales).
  const [doctorNombre, clinicaNombre, finanzas, fechaAceptadoIso] = await Promise.all([
    paciente.doctorLinkId ? loadStaffNombre(paciente.doctorLinkId) : Promise.resolve(null),
    paciente.clinicaId ? loadClinicaNombre(paciente.clinicaId) : Promise.resolve(null),
    finanzasDePaciente(pacienteId),
    loadFechaPrimerAceptado(pacienteId),
  ]);

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

  // MEJORAS nº 28/32 — {{importe}} y {{pendiente}} salen de la derivación
  // compartida, nunca de las cachés del paciente ni de un cálculo propio.
  const conAceptado = finanzas.firmado > 0;

  const base: Record<string, string> = {
    nombre: paciente.nombre || "",
    importe: conAceptado ? fmtImporteEs(finanzas.firmado) : "",
    pendiente: conAceptado ? fmtImporteEs(finanzas.pendiente) : "",
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
  if (o.pendiente !== undefined) out.pendiente = fmtImporteEs(o.pendiente);
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
    const { findClinicaCentralRaw } = await import("../auth/users");
    const rec = await findClinicaCentralRaw(clinicaId);
    return String((rec.fields as any)?.["Nombre"] ?? "") || null;
  } catch {
    return null;
  }
}

// Fecha de la PRIMERA aceptación — la que arranca el plazo en la cola de
// cobros. El dinero ({{importe}}/{{pendiente}}) ya no sale de aquí sino de
// finanzasDePaciente (MEJORAS nº 28/32).
async function loadFechaPrimerAceptado(pacienteId: string): Promise<string | null> {
  // Mismo patrón load+filter-JS que en Bloque 1.5 (Presupuestos no
  // tiene Paciente_RecordId todavia; deuda Sprint 14b/15).
  try {
    const recs = await selectPresupuestosRaw({
      fields: ["Paciente", "Estado", "Fecha_Aceptado"],
    });
    let fechaMin: string | null = null;
    for (const r of recs) {
      const f = r.fields as any;
      const links = (f?.["Paciente"] ?? []) as string[];
      if (links[0] !== pacienteId) continue;
      if (String(f["Estado"] ?? "") !== "ACEPTADO") continue;
      const fecha = f["Fecha_Aceptado"] ? String(f["Fecha_Aceptado"]).slice(0, 10) : null;
      if (fecha && (!fechaMin || fecha < fechaMin)) fechaMin = fecha;
    }
    return fechaMin;
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

// FASE 1 migración — passthroughs de Plantillas_Mensaje para el CRUD de la
// ruta de plantillas y el generador de cola de envíos.
export async function selectPlantillasMensajeRaw(opts: Record<string, unknown>): Promise<readonly any[]> {
  const pg = await import("./plantillas-pg");
  return pg.selectPlantillasMensajeRawPg(opts as any);
  
}
export async function findPlantillaMensajeRaw(id: string): Promise<any> {
  const pg = await import("./plantillas-pg");
  return pg.findPlantillaMensajeRawPg(id);
  
}
export async function createPlantillaMensajeRaw(fields: Record<string, unknown>): Promise<any> {
  const pg = await import("./plantillas-pg");
  return pg.createPlantillaMensajeRawPg(fields);
  
}
export async function updatePlantillaMensajeRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./plantillas-pg");
  return pg.updatePlantillaMensajeRawPg(id, fields);
  
}
export async function destroyPlantillaMensajeRaw(id: string): Promise<void> {
  const pg = await import("./plantillas-pg");
  return pg.destroyPlantillaMensajeRawPg(id);
  
}
