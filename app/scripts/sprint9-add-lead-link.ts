// app/scripts/sprint9-add-lead-link.ts
//
// Sprint 9 fix unificación Actuar Hoy — añade el campo `Lead_Link` a la
// tabla `Mensajes_WhatsApp` mediante Metadata API. Idempotente: si el
// campo ya existe, no hace nada.
//
// Uso:
//   npx tsx app/scripts/sprint9-add-lead-link.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;

if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}

async function main() {
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!tablesRes.ok) throw new Error(`tables ${tablesRes.status}`);
  const data = (await tablesRes.json()) as {
    tables: Array<{ id: string; name: string; fields: Array<{ name: string }> }>;
  };

  const mensajes = data.tables.find((t) => t.name === "Mensajes_WhatsApp");
  const leads = data.tables.find((t) => t.name === "Leads");
  if (!mensajes) throw new Error("Tabla Mensajes_WhatsApp no encontrada");
  if (!leads) throw new Error("Tabla Leads no encontrada");

  if (mensajes.fields.some((f) => f.name === "Lead_Link")) {
    console.log("✔ Lead_Link ya existe, nada que hacer");
    return;
  }

  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${mensajes.id}/fields`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Lead_Link",
        type: "multipleRecordLinks",
        options: { linkedTableId: leads.id },
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`crear Lead_Link: ${res.status} ${txt}`);
  }
  console.log("✔ Lead_Link añadido a Mensajes_WhatsApp");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
