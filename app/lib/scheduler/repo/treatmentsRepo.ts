// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";

export type TreatmentRow = {
  recordId: string;        // recXXXX
  treatmentId: string;     // SRV_01
  name: string;            // "Empaste"
  durationMin?: number;    // 40
  bufferBeforeMin?: number;// 0
  bufferAfterMin?: number; // 10
  category?: string;       // "Empaste"
  clinicRecordIds?: string[]; // links (record ids) desde Airtable
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function asNumber(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(String(x));
  return Number.isFinite(n) ? n : undefined;
}

export async function listTreatments(params?: {
  clinicRecordId?: string;
}): Promise<TreatmentRow[]> {
  const clinicRecordId = params?.clinicRecordId;

  const records = await base(TABLES.treatments).select({ maxRecords: 500 }).all();

  const mapped: TreatmentRow[] = records.map((r: any) => {
    const f: any = r.fields;

    // En tu screenshot la primera columna parece ser "Tratamientos" con SRV_01, SRV_02...
    const treatmentId = String(f["Tratamientos"] ?? f["Treatment ID"] ?? f["ID"] ?? "").trim();
    const name = String(f["Nombre"] ?? "").trim();

    const clinicLinks = Array.isArray(f["Clínica"]) ? f["Clínica"].map(String) : [];

    return {
      recordId: r.id,
      treatmentId,
      name,
      durationMin: asNumber(f["Duración"]),
      bufferBeforeMin: asNumber(f["Buffer antes"]),
      bufferAfterMin: asNumber(f["Buffer despues"]),
      category: firstString(f["Categoria"]) || firstString(f["Categoría"]) || "",
      clinicRecordIds: clinicLinks,
    };
  });

  const filtered = mapped
    .filter(t => !!t.treatmentId && !!t.name)
    .filter(t => {
      if (!clinicRecordId) return true;
      // Si el tratamiento tiene link a clínica, filtramos por ese recordId
      if (t.clinicRecordIds?.length) return t.clinicRecordIds.includes(clinicRecordId);
      // si no hay link, no filtramos (para no romper en demo)
      return true;
    });

  // orden estable por nombre
  filtered.sort((a, b) => a.name.localeCompare(b.name, "es"));

  return filtered;
}
