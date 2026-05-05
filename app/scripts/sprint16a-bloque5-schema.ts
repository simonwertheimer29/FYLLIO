// app/scripts/sprint16a-bloque5-schema.ts
//
// Sprint 16a Bloque 5 — schema migration foundational para Citas.
// Idempotente.
//
// La tabla Citas YA existe (Sprint 1-2 legacy) con campos: Paciente,
// Profesional (doctor), Clínica, Hora inicio, Hora final, Tratamiento,
// Estado, Origen, Notas, etc. Este bloque NO la recrea — añade los
// campos foundational necesarios para soportar los 4 escenarios de
// integración con sistemas externos (Gesden, Cliniweb, hybrid, native):
//
//   - Origen_Sistema  singleSelect (fyllio_native / gesden_synced /
//                     external_manual / sin_definir)
//   - External_Id     singleLineText (id en sistema externo)
//   - Sync_Status     singleSelect (pending / synced / error /
//                     not_applicable)
//   - Last_Sync_At    dateTime
//   - Duracion_Min    number (default 30, derivable de Hora inicio/final
//                     pero almacenarlo permite snapshots)
//   - Created_At      dateTime (created_time del registro, backfill)
//
// El campo legacy `Origen` (online / wa / referido / etc.) NO se toca:
// describe el canal de captación del paciente, no el sistema de
// agenda. Coexisten.
//
// Uso: npx tsx app/scripts/sprint16a-bloque5-schema.ts [--apply-prod]

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
  if (!res.ok) throw new Error(`add field ${field.name}: ${res.status} ${await res.text()}`);
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 16a Bloque 5 — schema · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const citas = tables.find((t) => t.name === "Citas");
  if (!citas) throw new Error("Citas no existe.");

  const has = (n: string) => Boolean(citas.fields.find((f) => f.name === n));

  if (!has("Origen_Sistema")) {
    await addField(citas.id, {
      name: "Origen_Sistema",
      type: "singleSelect",
      options: {
        choices: [
          { name: "fyllio_native", color: "blueBright" },
          { name: "gesden_synced", color: "purpleBright" },
          { name: "external_manual", color: "yellowBright" },
          { name: "sin_definir", color: "grayBright" },
        ],
      },
    });
    console.log("  Citas.Origen_Sistema: created");
  } else {
    console.log("  Citas.Origen_Sistema: exists");
  }

  if (!has("External_Id")) {
    await addField(citas.id, {
      name: "External_Id",
      type: "singleLineText",
    });
    console.log("  Citas.External_Id: created");
  } else {
    console.log("  Citas.External_Id: exists");
  }

  if (!has("Sync_Status")) {
    await addField(citas.id, {
      name: "Sync_Status",
      type: "singleSelect",
      options: {
        choices: [
          { name: "pending", color: "yellowBright" },
          { name: "synced", color: "greenBright" },
          { name: "error", color: "redBright" },
          { name: "not_applicable", color: "grayBright" },
        ],
      },
    });
    console.log("  Citas.Sync_Status: created");
  } else {
    console.log("  Citas.Sync_Status: exists");
  }

  if (!has("Last_Sync_At")) {
    await addField(citas.id, {
      name: "Last_Sync_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "Europe/Madrid",
      },
    });
    console.log("  Citas.Last_Sync_At: created");
  } else {
    console.log("  Citas.Last_Sync_At: exists");
  }

  if (!has("Duracion_Min")) {
    await addField(citas.id, {
      name: "Duracion_Min",
      type: "number",
      options: { precision: 0 },
    });
    console.log("  Citas.Duracion_Min: created");
  } else {
    console.log("  Citas.Duracion_Min: exists");
  }

  if (!has("Created_At")) {
    await addField(citas.id, {
      name: "Created_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "Europe/Madrid",
      },
    });
    console.log("  Citas.Created_At: created");
  } else {
    console.log("  Citas.Created_At: exists");
  }

  console.log("✔ Sprint 16a Bloque 5 schema OK");
  console.log(
    "  Nota: NO se backfillea Origen_Sistema='sin_definir' en records existentes.",
  );
  console.log(
    "  Cuando Sprint 19+ implemente el primer adapter, ese sprint hará el backfill.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
