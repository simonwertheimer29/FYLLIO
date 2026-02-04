// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";

export type TreatmentRow = {
  recordId: string;            // recXXXX
  serviceId?: string;          // SRV_01
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
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  const s = String(x ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function listTreatments(params: { clinicRecordId?: string }): Promise<TreatmentRow[]> {
  const { clinicRecordId } = params;

  const table = TABLES.treatments;
  const records = await base(table).select({ maxRecords: 200 }).all();

  console.log("[treatmentsRepo] fetched", {
    table,
    count: records.length,
    sampleFieldKeys: records[0] ? Object.keys(records[0].fields || {}) : [],
  });

  const out: TreatmentRow[] = records.map((r: any) => {
    const f: any = r.fields || {};

    // ✅ en TU base
    const serviceId = String(firstString(f["Tratamientos ID"]) || "").trim();

    // ✅ en TU base, el “nombre” está en Categoria (single select)
    const name = String(firstString(f["Categoria"]) || "").trim();

    const durationMin = toNum(f["Duración"]);
    const bufferBeforeMin = toNum(f["Buffer antes"]);
    const bufferAfterMin = toNum(f["Buffer despues"]);

    return {
      recordId: r.id,
      serviceId: serviceId || undefined,
      name: name || "(Sin nombre)",
      durationMin,
      bufferBeforeMin,
      bufferAfterMin,
    };
  });

  // ✅ mínimo: que exista name
  let filtered = out.filter((t) => t.name && t.name !== "(Sin nombre)");

  // (Opcional) filtro por clínica solo si existe lookup "Clínica ID" en Tratamientos
  if (clinicRecordId) {
    const withClinic = records.map((r: any) => {
      const f: any = r.fields || {};
      const clinicIdLookup = firstString(f["Clínica ID"]);
      return { recordId: r.id, clinicIdLookup };
    });

    const allowed = new Set(
      withClinic
        .filter((x) => x.clinicIdLookup && x.clinicIdLookup.length > 0)
        .map((x) => x.recordId)
    );

    if (allowed.size > 0) {
      filtered = filtered.filter((t) => allowed.has(t.recordId));
    }
  }

  filtered.sort((a, b) => (a.serviceId || a.name).localeCompare(b.serviceId || b.name));

  console.log("[treatmentsRepo] normalized", {
    count: filtered.length,
    sample: filtered.slice(0, 6).map((t) => ({
      recordId: t.recordId,
      serviceId: t.serviceId,
      name: t.name,
      durationMin: t.durationMin,
      bufferBeforeMin: t.bufferBeforeMin,
      bufferAfterMin: t.bufferAfterMin,
    })),
  });

  return filtered;
}
