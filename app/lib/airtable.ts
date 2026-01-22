// app/lib/airtable.ts
import Airtable from "airtable";

const baseId = process.env.AIRTABLE_BASE_ID!;
const apiKey = process.env.AIRTABLE_API_KEY!;

Airtable.configure({ apiKey });

export const base = Airtable.base(baseId);

// nombres EXACTOS de tablas en Airtable:
export const TABLES = {
  waitlist: "Lista_de_espera",
  clinics: "Clínicas",
  patients: "Pacientes",
  treatments: "Tratamientos",
  staff: "Staff",
  appointments: "Citas",
};
