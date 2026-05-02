// app/scripts/sprint14b-bloque0-schema.ts
//
// Sprint 14b Bloque 0 — schema migrations en Airtable via Metadata API.
// Idempotente.
//
// Cambios:
//
//  Tabla nueva Configuraciones_Clinica — config por clinica con
//  fallback a defaults globales cuando Clinica_Link es null.
//    - Resumen        singleLineText (primary, codigo lo rellena)
//    - Clinica_Link   multipleRecordLinks → Clínicas (opcional → null = global)
//    - Categoria      singleSelect (Metodos_Pago, Plazos_Liquidacion,
//                     Razones_No_Interesado, Plantillas_Scope)
//    - Valor          singleLineText
//    - Activo         checkbox
//    - Orden          number
//    - Created_At     dateTime
//
//  Plantillas_Mensaje — extender con Clinica_Link (multipleRecordLinks)
//  para permitir scope por clínica (Bloque 4 lo consume). El campo
//  legacy Clinica (singleLineText) queda para compat; se deprecara
//  cuando todas las plantillas se migren a Clinica_Link.

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
  console.error(`✖ Prod requiere --apply-prod explicito.`);
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
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, fields }),
    },
  );
  if (!res.ok) throw new Error(`crear ${name}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function addField(tableId: string, field: any) {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(field),
    },
  );
  if (!res.ok) {
    throw new Error(`add field: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 14b Bloque 0 — schema migrations · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const clinicas = tables.find((t) => t.name === "Clínicas");
  const plantillas = tables.find((t) => t.name === "Plantillas_Mensaje");
  if (!clinicas) throw new Error("Clínicas no existe.");
  if (!plantillas) throw new Error("Plantillas_Mensaje no existe.");

  // ── Configuraciones_Clinica ──────────────────────────────────────────
  if (tables.find((t) => t.name === "Configuraciones_Clinica")) {
    console.log("  Configuraciones_Clinica: exists");
  } else {
    await createTable(
      "Configuraciones_Clinica",
      "Sprint 14b Bloque 0 — configuracion por clinica con fallback a defaults globales (Clinica_Link=null).",
      [
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Clinica_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: clinicas.id },
        },
        {
          name: "Categoria",
          type: "singleSelect",
          options: {
            choices: [
              { name: "Metodos_Pago", color: "blueBright" },
              { name: "Plazos_Liquidacion", color: "yellowBright" },
              { name: "Razones_No_Interesado", color: "redBright" },
              { name: "Plantillas_Scope", color: "purpleBright" },
            ],
          },
        },
        { name: "Valor", type: "singleLineText" },
        { name: "Activo", type: "checkbox", options: { color: "greenBright", icon: "check" } },
        { name: "Orden", type: "number", options: { precision: 0 } },
        {
          name: "Created_At",
          type: "dateTime",
          options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "Europe/Madrid" },
        },
      ],
    );
    console.log("  Configuraciones_Clinica: created");
  }

  // ── Plantillas_Mensaje.Clinica_Link ──────────────────────────────────
  const plantillasFresh = (await fetchSchema()).find(
    (t) => t.name === "Plantillas_Mensaje",
  )!;
  const hasClinicaLink = plantillasFresh.fields.find(
    (f) => f.name === "Clinica_Link",
  );
  if (hasClinicaLink) {
    console.log("  Plantillas_Mensaje.Clinica_Link: exists");
  } else {
    await addField(plantillasFresh.id, {
      name: "Clinica_Link",
      type: "multipleRecordLinks",
      options: { linkedTableId: clinicas.id },
      description:
        "Sprint 14b Bloque 0 — scope por clinica para plantillas. Si null la plantilla es global.",
    });
    console.log("  Plantillas_Mensaje.Clinica_Link: added");
  }

  console.log(`✔ Schema 14b Bloque 0 aplicado en ${target}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
