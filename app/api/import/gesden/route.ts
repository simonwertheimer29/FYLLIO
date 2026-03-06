// app/api/import/gesden/route.ts
// POST: multipart/form-data with a "file" field containing a Gesden Pacientes CSV.
// Parses → validates → upserts patients to Airtable.
// Returns: { imported, updated, skipped, errors[] }

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import {
  parseCSV,
  detectPatientColumns,
  normalizePhone,
} from "../../../lib/integrations/gesden/columnMap";

const AIRTABLE_BATCH = 10; // Airtable rate-limit safe batch size

async function upsertPatient(fields: Record<string, string>): Promise<"created" | "updated" | "skipped"> {
  const phone = fields["Teléfono"];
  if (!phone) return "skipped";

  try {
    // Check if patient already exists by phone
    const existing = await base(TABLES.patients as any)
      .select({
        filterByFormula: `{Teléfono}='${phone.replace(/'/g, "\\'")}'`,
        maxRecords: 1,
        fields: ["Nombre", "Teléfono"],
      })
      .firstPage();

    if (existing.length > 0) {
      await base(TABLES.patients as any).update(existing[0].id, fields);
      return "updated";
    } else {
      await base(TABLES.patients as any).create(fields);
      return "created";
    }
  } catch {
    return "skipped";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const text = await file.text();
    const { headers, rows } = parseCSV(text);

    if (!headers.length || !rows.length) {
      return NextResponse.json({ error: "CSV vacío o no válido" }, { status: 400 });
    }

    const colMap = detectPatientColumns(headers);

    function getVal(row: Record<string, string>, key: keyof typeof colMap): string {
      const idx = colMap[key];
      if (idx < 0) return "";
      return Object.values(row)[idx]?.trim() ?? "";
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const preview: Array<{ nombre: string; telefono: string; nhc: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Build full name
      const primerApellido = getVal(row, "primerApellido");
      const segundoApellido = getVal(row, "segundoApellido");
      const nombrePila = getVal(row, "nombre");
      const fullName = [primerApellido, segundoApellido, nombrePila]
        .filter(Boolean)
        .join(" ")
        .trim();

      // Skip if no usable name
      if (!fullName) {
        skipped++;
        continue;
      }

      const rawPhone = getVal(row, "telefono") || getVal(row, "telefonoFijo");
      const phone = normalizePhone(rawPhone);

      const nhc = getVal(row, "nhc");
      const email = getVal(row, "email");
      const fechaNac = getVal(row, "fechaNacimiento");

      // Store first 10 rows for preview
      if (preview.length < 10) {
        preview.push({ nombre: fullName, telefono: phone || "(sin teléfono)", nhc });
      }

      const airtableFields: Record<string, string> = { Nombre: fullName };
      if (phone) airtableFields["Teléfono"] = phone;
      if (nhc) airtableFields["NHC_gesden"] = nhc;
      if (email) airtableFields["Email"] = email;
      if (fechaNac) airtableFields["Fecha_nacimiento"] = fechaNac;

      try {
        const result = await upsertPatient(airtableFields);
        if (result === "created") imported++;
        else if (result === "updated") updated++;
        else skipped++;
      } catch (e: any) {
        errors.push(`Fila ${i + 2}: ${e?.message ?? "Error"}`);
        skipped++;
      }

      // Throttle: 5 req/s safe for Airtable free tier
      if ((i + 1) % AIRTABLE_BATCH === 0) {
        await sleep(200);
      }
    }

    return NextResponse.json({
      ok: true,
      total: rows.length,
      imported,
      updated,
      skipped,
      errors: errors.slice(0, 20), // cap error list
      preview,
      detectedColumns: Object.fromEntries(
        Object.entries(colMap).map(([k, idx]) => [k, idx >= 0 ? headers[idx] : null])
      ),
    });
  } catch (e: any) {
    console.error("[gesden-import] error", e);
    return NextResponse.json({ error: e?.message ?? "Error al procesar el archivo" }, { status: 500 });
  }
}
