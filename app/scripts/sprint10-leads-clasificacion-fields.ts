// app/scripts/sprint10-leads-clasificacion-fields.ts
//
// Sprint 10 B — añade a la tabla Leads los 3 campos para clasificación IA:
//  - Intencion_Detectada  (singleSelect, 6 opciones leads)
//  - Mensaje_Sugerido     (multilineText)
//  - Accion_Sugerida      (multilineText)
//
// Idempotente: si los campos ya existen, no hace nada.
//
// Uso: npx tsx app/scripts/sprint10-leads-clasificacion-fields.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}

const FIELDS_TO_ADD: Array<Record<string, unknown>> = [
  {
    name: "Intencion_Detectada",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Interesado", color: "greenBright" },
        { name: "Pide más info", color: "blueBright" },
        { name: "Pregunta precio", color: "yellowBright" },
        { name: "Pide cita", color: "tealBright" },
        { name: "No interesado", color: "redBright" },
        { name: "Sin clasificar", color: "grayBright" },
      ],
    },
  },
  { name: "Mensaje_Sugerido", type: "multilineText" },
  { name: "Accion_Sugerida", type: "multilineText" },
];

async function main() {
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!tablesRes.ok) throw new Error(`tables ${tablesRes.status}`);
  const data = (await tablesRes.json()) as {
    tables: Array<{ id: string; name: string; fields: Array<{ name: string }> }>;
  };
  const leads = data.tables.find((t) => t.name === "Leads");
  if (!leads) throw new Error("Tabla Leads no encontrada");
  const existing = new Set(leads.fields.map((f) => f.name));

  for (const field of FIELDS_TO_ADD) {
    const name = field.name as string;
    if (existing.has(name)) {
      console.log(`✔ ${name} ya existe`);
      continue;
    }
    const res = await fetch(
      `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${leads.id}/fields`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(field),
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`crear ${name}: ${res.status} ${txt}`);
    }
    console.log(`✔ ${name} añadido`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
