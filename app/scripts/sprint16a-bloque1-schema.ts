// app/scripts/sprint16a-bloque1-schema.ts
//
// Sprint 16a Bloque 1 — schema migration para memoria persistente del
// Copilot. Idempotente.
//
// Tabla nueva Conversaciones_Copilot:
//   - Resumen          singleLineText (primary, code lo rellena con Titulo)
//   - Usuario_Link     multipleRecordLinks → Usuarios
//   - Clinica_Link     multipleRecordLinks → Clínicas (opcional)
//   - Titulo           singleLineText (auto del primer mensaje, máx 80)
//   - Mensajes         longText (JSON serializado del array completo)
//   - Mensaje_Count    number (entero)
//   - Modelo_Usado     singleLineText (sonnet | haiku, último turno)
//   - Created_At       dateTime (ISO Europe/Madrid)
//   - Updated_At       dateTime
//   - Activa           checkbox (true durante sesión, false al cerrar/archivar)
//
// Uso: npx tsx app/scripts/sprint16a-bloque1-schema.ts [--apply-prod]

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
  if (!res.ok) throw new Error(`add field: ${res.status} ${await res.text()}`);
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 16a Bloque 1 — schema · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const usuarios = tables.find((t) => t.name === "Usuarios");
  const clinicas = tables.find((t) => t.name === "Clínicas");
  if (!usuarios) throw new Error("Usuarios no existe.");
  if (!clinicas) throw new Error("Clínicas no existe.");

  const existing = tables.find((t) => t.name === "Conversaciones_Copilot");
  if (existing) {
    console.log("  Conversaciones_Copilot: exists (verificando campos…)");
    const need = (n: string) => !existing.fields.find((f) => f.name === n);
    if (need("Modelo_Usado")) {
      await addField(existing.id, { name: "Modelo_Usado", type: "singleLineText" });
      console.log("  · added Modelo_Usado");
    }
    console.log("✔ Sprint 16a Bloque 1 schema OK (table existed)");
    return;
  }

  await createTable(
    "Conversaciones_Copilot",
    "Sprint 16a Bloque 1 — memoria persistente del Copilot. Cada fila es una conversación con su array completo de mensajes en JSON.",
    [
      { name: "Resumen", type: "singleLineText" },
      {
        name: "Usuario_Link",
        type: "multipleRecordLinks",
        options: { linkedTableId: usuarios.id },
      },
      {
        name: "Clinica_Link",
        type: "multipleRecordLinks",
        options: { linkedTableId: clinicas.id },
      },
      { name: "Titulo", type: "singleLineText" },
      { name: "Mensajes", type: "multilineText" },
      { name: "Mensaje_Count", type: "number", options: { precision: 0 } },
      { name: "Modelo_Usado", type: "singleLineText" },
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
      {
        name: "Activa",
        type: "checkbox",
        options: { color: "greenBright", icon: "check" },
      },
    ],
  );
  console.log("  Conversaciones_Copilot: created");
  console.log("✔ Sprint 16a Bloque 1 schema OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
