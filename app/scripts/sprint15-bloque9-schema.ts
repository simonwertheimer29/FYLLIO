// app/scripts/sprint15-bloque9-schema.ts
//
// Sprint 15 Bloque 9 — schema migration en Airtable via Metadata API.
// Idempotente.
//
// Cambio:
//
//  Tabla Pacientes — añadir campo `CreatedAt` (dateTime editable)
//  para poder pasar `sort: [{ field: "CreatedAt", direction: "desc" }]`
//  a select() y eliminar el sort en JS sobre rec._rawJson.createdTime
//  (no es addressable desde el API select).
//
//  Airtable Meta API NO permite crear ni `formula` ni `createdTime`
//  fields. La opción soportada es un `dateTime` editable que se
//  rellena por código (createPaciente) y se backfill-ea al correr
//  esta migración (lee rec._rawJson.createdTime y lo escribe).
//
//  Uso: npx tsx app/scripts/sprint15-bloque9-schema.ts [--apply-prod]

import dotenv from "dotenv";
import Airtable from "airtable";
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

  // ── Step 1: crear el campo si no existe ──────────────────────────────
  const exists = pacientes.fields.find((f) => f.name === "CreatedAt");
  if (exists) {
    console.log("  Pacientes.CreatedAt: exists");
  } else {
    await addField(pacientes.id, {
      name: "CreatedAt",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "Europe/Madrid",
      },
    });
    console.log("  Pacientes.CreatedAt: created (dateTime)");
  }

  // ── Step 2: backfill (idempotente) ───────────────────────────────────
  // Lee todos los pacientes y rellena CreatedAt con _rawJson.createdTime
  // si está vacío. Skip si ya tiene valor.
  const base = new Airtable({ apiKey: KEY }).base(BASE_ID);
  const recs: any[] = [];
  await base("Pacientes")
    .select({ pageSize: 100 })
    .eachPage((page, next) => {
      recs.push(...page);
      next();
    });

  const toBackfill = recs.filter((r) => !r.fields["CreatedAt"]);
  console.log(
    `  Backfill: ${toBackfill.length} de ${recs.length} pacientes sin CreatedAt`,
  );

  if (toBackfill.length === 0) {
    console.log("✔ Sprint 15 Bloque 9 schema OK (sin backfill pendiente)");
    return;
  }

  // Airtable update permite hasta 10 records por batch
  for (let i = 0; i < toBackfill.length; i += 10) {
    const batch = toBackfill.slice(i, i + 10).map((r) => ({
      id: r.id,
      fields: { CreatedAt: r._rawJson?.createdTime ?? new Date().toISOString() },
    }));
    await base("Pacientes").update(batch);
    console.log(`    · backfilled ${Math.min(i + 10, toBackfill.length)}/${toBackfill.length}`);
  }

  console.log("✔ Sprint 15 Bloque 9 schema OK (con backfill)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
