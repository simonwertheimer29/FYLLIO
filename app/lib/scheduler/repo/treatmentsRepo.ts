// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";

export type TreatmentRow = {
  recordId: string;            // recXXXX
  serviceId: string;           // SRV_01
  name: string;                // Empaste, Limpieza...
  durationMin?: number;        // Duración (min)
  bufferBeforeMin?: number;    // Buffer antes
  bufferAfterMin?: number;     // Buffer despues
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toNum(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(String(x ?? ""));
  return Number.isFinite(n) ? n : undefined;
}

export async function listTreatments(params: { clinicRecordId?: string }): Promise<TreatmentRow[]> {
  const { clinicRecordId } = params;

  const records = await base(TABLES.treatments).select({ maxRecords: 200 }).all();

  const out: TreatmentRow[] = records.map((r: any) => {
    const f: any = r.fields;

    const serviceId = String(f["Tratamientos"] ?? "").trim();
    const name = String(f["Nombre"] ?? "").trim();

    const durationMin = toNum(f["Duración"]);
    const bufferBeforeMin = toNum(f["Buffer antes"]);
    const bufferAfterMin = toNum(f["Buffer despues"]);

    return {
      recordId: r.id,
      serviceId,
      name,
      durationMin,
      bufferBeforeMin,
      bufferAfterMin,
    };
  });

  // Filtro defensivo: solo los válidos
  let filtered = out.filter((t) => !!t.serviceId && !!t.name);

  // Si quieres filtrar por clínica: ideal tener lookup "Clínica ID"
  // Si NO lo tienes, lo dejamos sin filtrar (para no romper).
  if (clinicRecordId) {
    // intento 1: lookup "Clínica ID"
    // (si no existe, firstString devuelve "")
    const withClinic = records.map((r: any) => {
      const f: any = r.fields;
      const clinicIdLookup = firstString(f["Clínica ID"]);
      return { recordId: r.id, clinicIdLookup };
    });

    const allowed = new Set(
      withClinic.filter((x) => x.clinicIdLookup && x.clinicIdLookup.length > 0).map((x) => x.recordId)
    );

    // si hay lookup en alguno, filtramos; si no, no filtramos
    if (allowed.size > 0) {
      filtered = filtered.filter((t) => allowed.has(t.recordId));
    }
  }

  // orden (por serviceId)
  filtered.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  return filtered;
}
