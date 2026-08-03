// app/lib/integrations/gesden/columnMap.ts
// Mapping from Gesden CSV column names → Fyllio/Airtable field names.
// Each key is a Fyllio field; the value is a list of candidate Gesden column headers
// (case-insensitive match, first match wins).

import { telefonoParaGuardar } from "../../telefono";

export const GESDEN_PATIENT_CANDIDATES = {
  primerApellido: ["Primer apellido", "Apellido 1", "Primer Apellido"],
  segundoApellido: ["Segundo apellido", "Apellido 2"],
  nombre: ["Nombre", "nombre", "Nombre paciente"],
  telefono: [
    "Teléfono móvil", "Telefono movil", "Móvil", "movil", "Teléfono", "telefono",
    "Tel. Móvil", "Tel movil", "Celular",
  ],
  telefonoFijo: ["Teléfono fijo", "Fijo", "Tel. Fijo"],
  email: ["Email", "email", "Correo electrónico", "Correo"],
  fechaNacimiento: ["Fecha nacimiento", "Fecha Nacimiento", "F. Nacimiento", "Fec. Nac."],
  nhc: ["NHC", "nhc", "Nº Historia", "N Historia", "Historia", "Nº HC", "N HC"],
  sexo: ["Sexo", "sexo", "Género", "genero"],
  direccion: ["Dirección", "Direccion", "domicilio"],
  codigoPostal: ["Código postal", "CP", "C.P."],
  poblacion: ["Población", "Localidad", "Ciudad"],
} as const;

export type GesdenPatientKey = keyof typeof GESDEN_PATIENT_CANDIDATES;

/**
 * Given a list of CSV headers, returns a map of GesdenPatientKey → column index.
 * Returns -1 for keys not found in the headers.
 */
export function detectPatientColumns(
  headers: string[]
): Record<GesdenPatientKey, number> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  return Object.fromEntries(
    (Object.entries(GESDEN_PATIENT_CANDIDATES) as [GesdenPatientKey, readonly string[]][]).map(
      ([key, candidates]) => {
        const idx = candidates.findIndex((c) => lower.includes(c.toLowerCase()));
        return [key, idx >= 0 ? lower.indexOf(candidates[idx].toLowerCase()) : -1];
      }
    )
  ) as Record<GesdenPatientKey, number>;
}

/**
 * Parses a CSV text (auto-detects , or ; delimiter) into headers + row objects.
 */
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const firstLine = text.split("\n")[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const delimiter = semicolons > commas ? ";" : ",";

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    // Handles quoted fields containing delimiters
    const result: string[] = [];
    let current = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === delimiter && !inQuote) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });

  return { headers, rows };
}

/**
 * Normaliza un teléfono a E.164. Delega en `lib/telefono`, que es la única
 * verdad del formato desde 2026-08-03.
 *
 * Esta función tenía su propia versión, y difería en lo que importa: ante 10+
 * dígitos sin "+" le pegaba un "+" y devolvía el número como si fuera bueno.
 * Eso convierte un dato malo en un dato malo con pinta de bueno, que es peor —
 * el compartido lo devuelve como dudoso y conserva el original. Se unifica en
 * vez de dejar dos convenciones para lo mismo (el error que ya tenemos vivo con
 * `META_WHATSAPP_TOKEN` frente a `WABA_ACCESS_TOKEN`, ver MEJORAS 5B).
 */
export function normalizePhone(raw: string): string {
  return telefonoParaGuardar(raw) ?? "";
}
