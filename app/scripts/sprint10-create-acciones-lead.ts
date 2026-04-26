// app/scripts/sprint10-create-acciones-lead.ts
//
// Sprint 10 C — crea la tabla Acciones_Lead via Metadata API. Idempotente:
// si la tabla ya existe, no hace nada.
//
// Campos:
//  - ID                Autonumber (primary)
//  - Lead              multipleRecordLinks → Leads
//  - Tipo_Accion       singleSelect (5 opciones)
//  - Timestamp         dateTime (lo setea el caller, NO createdTime)
//  - Usuario           multipleRecordLinks → Usuarios (opcional)
//  - Detalles          multilineText
//
// Uso: npx tsx app/scripts/sprint10-create-acciones-lead.ts

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
    tables: Array<{ id: string; name: string }>;
  };

  if (data.tables.some((t) => t.name === "Acciones_Lead")) {
    console.log("✔ Acciones_Lead ya existe, nada que hacer");
    return;
  }

  const leads = data.tables.find((t) => t.name === "Leads");
  const usuarios = data.tables.find((t) => t.name === "Usuarios");
  if (!leads) throw new Error("Tabla Leads no encontrada");
  if (!usuarios) throw new Error("Tabla Usuarios no encontrada");

  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Acciones_Lead",
      description:
        "Sprint 10 C — log estructurado de acciones sobre Leads. Base del KPI tiempo medio respuesta + auditoría.",
      fields: [
        // Primary field — el código setea esto al crear (ej "WhatsApp_Saliente · 2026-04-26 14:32").
        // Metadata API no permite crear autoNumber programáticamente.
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Lead",
          type: "multipleRecordLinks",
          options: { linkedTableId: leads.id },
        },
        {
          name: "Tipo_Accion",
          type: "singleSelect",
          options: {
            choices: [
              { name: "Llamada", color: "blueBright" },
              { name: "WhatsApp_Saliente", color: "greenBright" },
              { name: "WhatsApp_Entrante", color: "yellowBright" },
              { name: "Cambio_Estado", color: "purpleBright" },
              { name: "Nota", color: "grayBright" },
            ],
          },
        },
        {
          name: "Timestamp",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "Europe/Madrid",
          },
        },
        {
          name: "Usuario",
          type: "multipleRecordLinks",
          options: { linkedTableId: usuarios.id },
        },
        { name: "Detalles", type: "multilineText" },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`crear Acciones_Lead: ${res.status} ${txt}`);
  }
  const created = await res.json();
  console.log(`✔ Acciones_Lead creada: ${created.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
