// app/scripts/sprint15-bloque9-schema.ts
//
// Sprint 15 Bloque 9 — schema migration en Airtable via Metadata API.
// Idempotente.
//
// Cambio:
//
//  Tabla Pacientes — añadir campo formula `CreatedAt` con expresion
//  CREATED_TIME() para poder pasar `sort: [{ field: "CreatedAt",
//  direction: "desc" }]` a select() y eliminar el sort en JS sobre
//  rec._rawJson.createdTime (no es addressable desde el API select).
//
//  Uso: npx tsx app/scripts/sprint15-bloque9-schema.ts [--apply-prod]

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

async function addField(tableId: string, field: any) {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(field),
    },
  );
  if (!res.ok) throw new Error(`add field: ${res.status} ${await res.text()}`);
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 15 Bloque 9 — schema · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const pacientes = tables.find((t) => t.name === "Pacientes");
  if (!pacientes) throw new Error("Pacientes no existe.");

  if (pacientes.fields.find((f) => f.name === "CreatedAt")) {
    console.log("  Pacientes.CreatedAt: exists");
  } else {
    await addField(pacientes.id, {
      name: "CreatedAt",
      type: "formula",
      options: {
        formula: "CREATED_TIME()",
        // Airtable infiere result type dateTime cuando la formula es CREATED_TIME().
      },
    });
    console.log("  Pacientes.CreatedAt: created (formula CREATED_TIME())");
  }

  console.log("✔ Sprint 15 Bloque 9 schema OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
