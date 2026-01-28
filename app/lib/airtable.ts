// app/lib/airtable.ts
import Airtable from "airtable";

export const TABLES = {
  waitlist: "Lista_de_espera",
  clinics: "Clínicas",
  patients: "Pacientes",
  treatments: "Tratamientos",
  staff: "Staff",
  appointments: "Citas",
  sillones: "Sillones",

} as const;

type TableName = (typeof TABLES)[keyof typeof TABLES];

let _base: Airtable.Base | null = null;

export function base(tableName: TableName) {
  if (!_base) {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;

    if (!baseId || !apiKey) {
      throw new Error(
        `Missing Airtable env vars. AIRTABLE_BASE_ID=${!!baseId} AIRTABLE_API_KEY=${!!apiKey}`
      );
    }

    Airtable.configure({ apiKey });
    _base = Airtable.base(baseId);
  }

  return _base(tableName);
}

const apiKey = process.env.AIRTABLE_API_KEY?.trim();

if (!apiKey) {
  throw new Error("Missing AIRTABLE_API_KEY");
}
