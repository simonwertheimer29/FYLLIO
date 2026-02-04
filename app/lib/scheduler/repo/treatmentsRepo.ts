// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";

export type TreatmentRow = {
  recordId: string;            // recXXXX
  serviceId?: string;          // SRV_01 (si existe)
  name: string;                // Empaste, Limpieza...
  durationMin?: number;        // Duración (min)
  bufferBeforeMin?: number;    // Buffer antes
  bufferAfterMin?: number;     // Buffer después
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

function firstNonEmptyFieldString(fields: any, candidates: string[]): string {
  for (const key of candidates) {
    const v = firstString(fields?.[key]);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function firstNonEmptyFieldNumber(fields: any, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const v = toNum(fields?.[key]);
    if (typeof v === "number") return v;
  }
  return undefined;
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

    // ✅ ID / código del servicio (SRV_01…) — intentamos varios nombres
    const serviceId = firstNonEmptyFieldString(f, [
      "Tratamientos",
      "Tratamiento_id",
      "Tratamiento ID",
      "Service ID",
      "Servicio ID",
      "ID",
      "Codigo",
      "Código",
    ]);

    // ✅ Nombre del tratamiento — intentamos varios nombres
    const name = firstNonEmptyFieldString(f, [
      "Nombre",
      "Name",
      "Tratamiento",
      "Servicio",
      "Title",
    ]);

    // ✅ Duración y buffers — intentamos variantes
    const durationMin = firstNonEmptyFieldNumber(f, [
      "Duración",
      "Duracion",
      "Duración (min)",
      "Duracion (min)",
      "Duracion_min",
      "Duración_min",
    ]);

    const bufferBeforeMin = firstNonEmptyFieldNumber(f, [
      "Buffer antes",
      "Buffer_antes",
      "Buffer Antes",
      "BufferBefore",
      "Buffer before",
    ]);

    const bufferAfterMin = firstNonEmptyFieldNumber(f, [
      "Buffer despues",
      "Buffer después",
      "Buffer_despues",
      "Buffer_después",
      "Buffer Despues",
      "Buffer Después",
      "BufferAfter",
      "Buffer after",
    ]);

    return {
      recordId: r.id,
      serviceId: serviceId || undefined,
      name: name || "(Sin nombre)",
      durationMin,
      bufferBeforeMin,
      bufferAfterMin,
    };
  });

  // ✅ mínimo: que haya nombre decente (no filtramos por serviceId)
  let filtered = out.filter((t) => t.name && t.name !== "(Sin nombre)");

  // (Opcional) filtro por clínica solo si existe lookup "Clínica ID"
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

    // si hay lookup en alguno, filtramos; si no, no filtramos
    if (allowed.size > 0) {
      filtered = filtered.filter((t) => allowed.has(t.recordId));
    }
  }

  // orden estable: por serviceId si existe, si no por name
  filtered.sort((a, b) => {
    const ak = a.serviceId || a.name;
    const bk = b.serviceId || b.name;
    return ak.localeCompare(bk);
  });

  console.log("[treatmentsRepo] normalized", {
    count: filtered.length,
    sample: filtered.slice(0, 5).map((t) => ({
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
