// app/lib/scheduler/repo/staffRepo.ts
import { base, TABLES } from "../../airtable";

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
  const records = await base(TABLES.staff).select({ maxRecords: 200 }).all();

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
      horarioLaboral: String(f["Horario laboral"] ?? "").trim() || undefined,
      almuerzoInicio: f["Almuerzo_inicio"],
      almuerzoFin: f["Almuerzo_fin"],
      treatments,
    };
  }).filter(s => !!s.staffId);
}
