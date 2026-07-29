// app/lib/scheduler/repo/staffRepo.ts

export type StaffRow = {
  recordId: string;      // recXXXX
  staffId: string;        // STF_001
  name: string;           // "Mateo López"
  activo: boolean;
  horarioLaboral?: string; // "08:30-19:00"
  almuerzoInicio?: any;    // puede ser date o string según Airtable
  almuerzoFin?: any;
  treatments?: string[];   // si lo tienes como multi-select o lookup
  rol?: string;
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function firstBool(x: unknown): boolean {
  if (typeof x === "boolean") return x;
  return Boolean(x);
}

export async function listStaff(): Promise<StaffRow[]> {
  // MEJORAS 45 — esta era la única función del repo sin gate: leía Airtable
  // siempre, y Staff está vacía en las bases piloto.
  const { listStaffFirstPageRawPg } = await import("./pg");
  const records = await listStaffFirstPageRawPg(200);

  return records.map((r: any) => {
    const f: any = r.fields;

    const staffId = String(f["Staff ID"] ?? "").trim();
    const name = String(f["Nombre"] ?? "").trim();
    const activo = firstBool(f["Activo"]);
    const rol = String(f["Rol"] ?? "").trim();

    // opcional: treatments (depende cómo lo tengas)
    const treatments =
      Array.isArray(f["Tratamientos"]) ? f["Tratamientos"].map(String) :
      Array.isArray(f["treatments"]) ? f["treatments"].map(String) :
      undefined;

    return {
      recordId: r.id,
      staffId,
      name,
      activo,
      rol,
      horarioLaboral: String(f["Horario laboral"] ?? "").trim() || undefined,
      almuerzoInicio: f["Almuerzo_inicio"],
      almuerzoFin: f["Almuerzo_fin"],
      treatments,
    };
  }).filter(s => !!s.staffId);
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — acceso restante a la tabla Staff.
// ─────────────────────────────────────────────────────────────────────


/** Map recordId → Nombre para resolver doctores por lote de IDs. */
export async function mapStaffNombrePorIds(ids: string[]): Promise<Map<string, string>> {
  const pg = await import("./pg");
  return pg.mapStaffNombrePorIdsPg(ids);
}

/** Record crudo de un staff por su Staff ID (agenda demo lee Nombre,
 *  Horario laboral y Almuerzo via rec.get()). null si no existe. */
export async function findStaffPorStaffIdRaw(staffId: string): Promise<any | null> {
  const pg = await import("./pg");
  return pg.findStaffPorStaffIdRawPg(staffId);
}

/** Campo Horario de un staff por record id (validación de nueva cita). */
export async function getStaffHorarioPorRecordId(staffRecordId: string): Promise<any | null> {
  const pg = await import("./pg");
  return pg.getStaffHorarioPorRecordIdPg(staffRecordId);
}

/** Primera página del staff (lista demo /api/db/staff). */
export async function listStaffFirstPageRaw(maxRecords = 200): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listStaffFirstPageRawPg(maxRecords);
}

/** Nombre de un staff por record id (plantillas). Lanza si no existe. */
export async function getStaffNombrePorId(staffId: string): Promise<string> {
  const pg = await import("./pg");
  return pg.getStaffNombrePorIdPg(staffId);
}

/** Record crudo por id (motor no-shows enriquece el histórico). */
export async function findStaffRaw(recId: string): Promise<any> {
  const pg = await import("./pg");
  return pg.findStaffRawPg(recId);
}

/** Volcado con fields explícitos (superficie diferida no-shows: mapas
 *  Staff ID / Nombre / Clínica / Rol). Se re-tipa al migrar ese módulo. */
export async function listStaffCamposRaw(fields: string[]): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listStaffCamposRawPg(fields);
}

