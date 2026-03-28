/**
 * scripts/setup-airtable-fields.ts
 * Crea los campos faltantes en la tabla Presupuestos de Airtable.
 * Los campos existentes se respetan (no se modifican ni eliminan).
 *
 * Uso:
 *   npx tsx scripts/setup-airtable-fields.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

type FieldDef =
  | { name: string; type: "singleLineText" | "multilineText" | "number" | "date" }
  | { name: string; type: "singleSelect"; options: { choices: { name: string }[] } };

// Fields we need (the seed + route depend on these exact names)
const FIELDS_TO_CREATE: FieldDef[] = [
  { name: "Paciente_Nombre",      type: "singleLineText" },
  { name: "Paciente_Telefono",    type: "singleLineText" },
  { name: "Tratamiento_nombres",  type: "singleLineText" },
  { name: "Doctor",               type: "singleLineText" },
  { name: "Doctor_Especialidad",  type: "singleLineText" },
  {
    name: "TipoPaciente",
    type: "singleSelect",
    options: { choices: [{ name: "Privado" }, { name: "Adeslas" }] },
  },
  {
    name: "TipoVisita",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Primera Visita" },
        { name: "Paciente con Historia" },
      ],
    },
  },
  { name: "Clinica",             type: "singleLineText" },
  { name: "FechaAlta",          type: "date" },
  { name: "UltimoContacto",     type: "date" },
  { name: "ContactCount",       type: "number" },
  { name: "CreadoPor",          type: "singleLineText" },
  { name: "NumHistoria",        type: "singleLineText" },
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // 1. Get table ID for "Presupuestos"
  console.log("🔍 Obteniendo estructura de la base...");
  const metaRes = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: HEADERS }
  );
  if (!metaRes.ok) {
    console.error(`❌ Error ${metaRes.status}: ${await metaRes.text()}`);
    process.exit(1);
  }
  const meta = (await metaRes.json()) as any;
  const table = (meta.tables ?? []).find((t: any) => t.name === "Presupuestos");
  if (!table) {
    console.error("❌ No se encontró la tabla 'Presupuestos'. Revisa el nombre exacto.");
    process.exit(1);
  }

  const tableId: string = table.id;
  const existingNames: Set<string> = new Set(
    (table.fields ?? []).map((f: any) => f.name as string)
  );

  console.log(`   Tabla ID: ${tableId}`);
  console.log(`   Campos existentes (${existingNames.size}): ${[...existingNames].join(", ")}\n`);

  // 2. Create missing fields
  let created = 0;
  let skipped = 0;

  for (const fieldDef of FIELDS_TO_CREATE) {
    if (existingNames.has(fieldDef.name)) {
      console.log(`   ⏭  Ya existe: ${fieldDef.name}`);
      skipped++;
      continue;
    }

    const body: Record<string, unknown> = {
      name: fieldDef.name,
      type: fieldDef.type,
    };

    if (fieldDef.type === "singleSelect") {
      body.options = (fieldDef as any).options;
    }

    if (fieldDef.type === "date") {
      body.options = { dateFormat: { name: "iso" } };
    }

    if (fieldDef.type === "number") {
      body.options = { precision: 0 };
    }

    const res = await fetch(
      `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`,
      {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
      }
    );

    if (res.ok) {
      console.log(`   ✅ Creado: ${fieldDef.name} (${fieldDef.type})`);
      created++;
    } else {
      const err = await res.json() as any;
      console.error(`   ❌ Error creando ${fieldDef.name}: ${err?.error?.message ?? JSON.stringify(err)}`);
    }

    await sleep(300); // avoid rate limit
  }

  // 3. Also ensure Estado singleSelect has all 6 options
  const estadoField = (table.fields ?? []).find((f: any) => f.name === "Estado");
  if (estadoField && estadoField.type === "singleSelect") {
    const existingChoices: Set<string> = new Set(
      (estadoField.options?.choices ?? []).map((c: any) => c.name as string)
    );
    const neededChoices = [
      "PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION", "ACEPTADO", "PERDIDO",
    ];
    const missingChoices = neededChoices.filter((c) => !existingChoices.has(c));

    if (missingChoices.length > 0) {
      console.log(`\n📝 Añadiendo opciones a 'Estado': ${missingChoices.join(", ")}`);
      const allChoices = [
        ...(estadoField.options?.choices ?? []),
        ...missingChoices.map((name) => ({ name })),
      ];
      const updateRes = await fetch(
        `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${estadoField.id}`,
        {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({ options: { choices: allChoices } }),
        }
      );
      if (updateRes.ok) {
        console.log("   ✅ Opciones de Estado actualizadas");
      } else {
        const err = await updateRes.json() as any;
        console.error(`   ❌ Error actualizando Estado: ${JSON.stringify(err)}`);
      }
    } else {
      console.log("\n✅ Estado ya tiene todas las opciones necesarias");
    }
  }

  console.log(`\n🎉 Listo: ${created} campos creados, ${skipped} ya existían.`);
  if (created > 0) {
    console.log("\nAhora ejecuta el seed:");
    console.log("  npx tsx scripts/seed-presupuestos.ts");
  }
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
