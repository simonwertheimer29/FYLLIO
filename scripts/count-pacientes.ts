import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim()!;
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim()!;

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

async function main() {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base("Pacientes").select({ maxRecords: 5, fields: ["Nombre"] }).eachPage((page, next) => {
    recs.push(...page);
    next();
  });
  console.log(`${recs.length} pacientes encontrados`);
  recs.forEach((r) => console.log(` ${r.id}  ${r.get("Nombre")}`));
}
main().catch(console.error);
