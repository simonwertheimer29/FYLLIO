// app/scripts/sprint131-create-pagos-paciente.ts
//
// Sprint 13.1 Bloque 0.1 — crea la tabla Pagos_Paciente via Metadata API.
// Idempotente: si la tabla ya existe, no la recrea.
//
// Schema:
//  - Resumen        singleLineText (primary; el codigo lo rellena al
//                   crear). Metadata API no permite crear autoNumber.
//  - Paciente_Link  multipleRecordLinks → Pacientes
//  - Fecha_Pago     date (default = today se setea desde el codigo)
//  - Importe        currency (EUR)
//  - Metodo         singleSelect (Efectivo, Tarjeta, Transferencia, Bizum, Financiacion, Otro)
//  - Tipo           singleSelect (Pago_Unico, Cuota, Senal, Liquidacion)
//  - Nota           multilineText
//
// CreatedAt y CreatedBy son automaticos en cada record en Airtable
// (no requieren campo explicito).
//
// Uso: npx tsx app/scripts/sprint131-create-pagos-paciente.ts

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

  const existing = data.tables.find((t) => t.name === "Pagos_Paciente");
  if (existing) {
    console.log(`✔ Pagos_Paciente ya existe: ${existing.id}`);
    return;
  }

  const pacientes = data.tables.find((t) => t.name === "Pacientes");
  if (!pacientes) throw new Error("Tabla Pacientes no encontrada");

  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Pagos_Paciente",
      description:
        "Sprint 13.1 Bloque 0 — log estructurado de pagos de paciente. Soporta tandas/financiacion. Pacientes.Pagado se mantiene como cache total y se sincroniza al insertar pagos.",
      fields: [
        // Primary: rellenado por el codigo (Metadata API no permite autoNumber al crear).
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Paciente_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: pacientes.id },
        },
        {
          name: "Fecha_Pago",
          type: "date",
          options: { dateFormat: { name: "iso" } },
        },
        {
          name: "Importe",
          type: "currency",
          options: { precision: 2, symbol: "€" },
        },
        {
          name: "Metodo",
          type: "singleSelect",
          options: {
            choices: [
              { name: "Efectivo", color: "greenBright" },
              { name: "Tarjeta", color: "blueBright" },
              { name: "Transferencia", color: "purpleBright" },
              { name: "Bizum", color: "tealBright" },
              { name: "Financiacion", color: "yellowBright" },
              { name: "Otro", color: "grayBright" },
            ],
          },
        },
        {
          name: "Tipo",
          type: "singleSelect",
          options: {
            choices: [
              { name: "Pago_Unico", color: "greenBright" },
              { name: "Cuota", color: "blueBright" },
              { name: "Senal", color: "yellowBright" },
              { name: "Liquidacion", color: "purpleBright" },
            ],
          },
        },
        { name: "Nota", type: "multilineText" },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`crear Pagos_Paciente: ${res.status} ${txt}`);
  }
  const created = await res.json();
  console.log(`✔ Pagos_Paciente creada en Dev: ${created.id}`);
  console.log("   Para Prod (appfUJcyGnkZ16Fhr): re-ejecuta con AIRTABLE_BASE_ID apuntando a Prod.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
