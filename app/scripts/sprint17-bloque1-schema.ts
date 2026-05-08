// app/scripts/sprint17-bloque1-schema.ts
//
// Sprint 17 Bloque 1 — schema para Voice IA con Vapi.
// Idempotente.
//
// Tabla nueva Llamadas_Vapi:
//   - Resumen          singleLineText (primary, code lo rellena)
//   - Cita_Link        multipleRecordLinks → Citas (opcional)
//   - Paciente_Link    multipleRecordLinks → Pacientes
//   - Tipo_Llamada     singleSelect (confirmacion_cita / reactivacion /
//                      recuperacion_presupuesto)
//   - Vapi_Call_Id     singleLineText
//   - Estado           singleSelect (pendiente / iniciada / en_curso /
//                      completada / fallida / cancelada)
//   - Resultado        singleSelect (confirmada / reagenda_solicitada /
//                      cancelada / no_contesta / escalado_humano /
//                      sin_resultado)
//   - Iniciada_At      dateTime
//   - Finalizada_At    dateTime (opcional)
//   - Duracion_Segundos number
//   - Notas            multilineText
//   - Transcripcion    multilineText
//   - Coste_USD        number
//   - Created_At       dateTime
//   - Updated_At       dateTime
//
// Uso: npx tsx app/scripts/sprint17-bloque1-schema.ts [--apply-prod]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";

if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}
if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error("✖ Prod requiere --apply-prod explicito.");
  process.exit(1);
}

type FieldMeta = { id: string; name: string; type: string; options?: any };
type TableMeta = { id: string; name: string; fields: FieldMeta[] };

async function fetchSchema(): Promise<TableMeta[]> {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) throw new Error(`schema: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { tables: TableMeta[] }).tables;
}

async function createTable(name: string, description: string, fields: any[]) {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, description, fields }),
    },
  );
  if (!res.ok) throw new Error(`crear ${name}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 17 Bloque 1 — schema · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const citas = tables.find((t) => t.name === "Citas");
  const pacientes = tables.find((t) => t.name === "Pacientes");
  if (!citas) throw new Error("Citas no existe.");
  if (!pacientes) throw new Error("Pacientes no existe.");

  if (tables.find((t) => t.name === "Llamadas_Vapi")) {
    console.log("  Llamadas_Vapi: exists");
    console.log("✔ Sprint 17 Bloque 1 schema OK (table existed)");
    return;
  }

  await createTable(
    "Llamadas_Vapi",
    "Sprint 17 — registros de llamadas IA salientes via Vapi (Use Case 1: confirmación de citas).",
    [
      { name: "Resumen", type: "singleLineText" },
      {
        name: "Cita_Link",
        type: "multipleRecordLinks",
        options: { linkedTableId: citas.id },
      },
      {
        name: "Paciente_Link",
        type: "multipleRecordLinks",
        options: { linkedTableId: pacientes.id },
      },
      {
        name: "Tipo_Llamada",
        type: "singleSelect",
        options: {
          choices: [
            { name: "confirmacion_cita", color: "blueBright" },
            { name: "reactivacion", color: "purpleBright" },
            { name: "recuperacion_presupuesto", color: "tealBright" },
          ],
        },
      },
      { name: "Vapi_Call_Id", type: "singleLineText" },
      {
        name: "Estado",
        type: "singleSelect",
        options: {
          choices: [
            { name: "pendiente", color: "grayBright" },
            { name: "iniciada", color: "yellowBright" },
            { name: "en_curso", color: "blueBright" },
            { name: "completada", color: "greenBright" },
            { name: "fallida", color: "redBright" },
            { name: "cancelada", color: "grayBright" },
          ],
        },
      },
      {
        name: "Resultado",
        type: "singleSelect",
        options: {
          choices: [
            { name: "confirmada", color: "greenBright" },
            { name: "reagenda_solicitada", color: "yellowBright" },
            { name: "cancelada", color: "redBright" },
            { name: "no_contesta", color: "grayBright" },
            { name: "escalado_humano", color: "orangeBright" },
            { name: "sin_resultado", color: "grayBright" },
          ],
        },
      },
      {
        name: "Iniciada_At",
        type: "dateTime",
        options: {
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
          timeZone: "Europe/Madrid",
        },
      },
      {
        name: "Finalizada_At",
        type: "dateTime",
        options: {
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
          timeZone: "Europe/Madrid",
        },
      },
      { name: "Duracion_Segundos", type: "number", options: { precision: 0 } },
      { name: "Notas", type: "multilineText" },
      { name: "Transcripcion", type: "multilineText" },
      { name: "Coste_USD", type: "number", options: { precision: 4 } },
      {
        name: "Created_At",
        type: "dateTime",
        options: {
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
          timeZone: "Europe/Madrid",
        },
      },
      {
        name: "Updated_At",
        type: "dateTime",
        options: {
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
          timeZone: "Europe/Madrid",
        },
      },
    ],
  );
  console.log("  Llamadas_Vapi: created");
  console.log("✔ Sprint 17 Bloque 1 schema OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
