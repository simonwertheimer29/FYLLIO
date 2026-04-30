// app/scripts/sprint14-schema-migrations.ts
//
// Sprint 14a Bloque 0 — schema migrations en Airtable via Metadata API.
// Idempotente: si el campo ya existe, skip silencioso. Re-correrlo es
// seguro.
//
// Cambios:
//
//  Pagos_Paciente:
//    - Paciente_RecordId (singleLineText)
//        Texto plano que el codigo rellena al crear el pago, igual al
//        record id de Paciente. Permite filtrar via filterByFormula
//        directo ("{Paciente_RecordId}='recXXX'") sin pasar por
//        ARRAYJOIN({Paciente_Link}) — esa formula devuelve el primary
//        field de Pacientes ("PAT_NNN"), no record IDs (bug detectado
//        en Sprint 13.1.1).
//    - Usuario_Creador (multipleRecordLinks → Usuarios)
//        Auditoria real de quien registro el pago. Airtable createdBy
//        siempre devuelve el API token, inutil para trazabilidad.
//
//  Presupuestos:
//    - Fecha_Aceptado (date)
//        Se rellena cuando un presupuesto pasa a Estado="Aceptado".
//        Para presupuestos legacy ya en estado Aceptado sin fecha, queda
//        null (la heuristica de urgencia lo trata como antiguedad
//        desconocida y asume default sin romper trigger).
//
// Uso:
//   npx tsx app/scripts/sprint14-schema-migrations.ts
//   AIRTABLE_BASE_ID=appfUJcyGnkZ16Fhr npx tsx ... --apply-prod
//
// Guard de seguridad: si la base es Prod (appfUJcyGnkZ16Fhr) requiere
// flag --apply-prod explicito para evitar accidentes.

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
  console.error(
    `✖ AIRTABLE_BASE_ID apunta a Prod (${PROD_BASE_ID}). Requiere --apply-prod explicito.`,
  );
  process.exit(1);
}

type FieldDef = {
  name: string;
  type: string;
  options?: Record<string, unknown>;
  description?: string;
};

type TableMeta = {
  id: string;
  name: string;
  fields: Array<{ id: string; name: string; type: string }>;
};

async function fetchSchema(): Promise<TableMeta[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`fetch schema: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { tables: TableMeta[] };
  return data.tables;
}

async function ensureField(table: TableMeta, field: FieldDef): Promise<"created" | "exists"> {
  const existing = table.fields.find((f) => f.name === field.name);
  if (existing) {
    if (existing.type !== field.type) {
      console.log(
        `  ⚠ ${table.name}.${field.name} ya existe pero con tipo ${existing.type} (esperado ${field.type}). Skip.`,
      );
    }
    return "exists";
  }
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${table.id}/fields`,
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
    throw new Error(
      `crear ${table.name}.${field.name}: ${res.status} ${await res.text()}`,
    );
  }
  return "created";
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 14a Bloque 0 — schema migrations · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();

  const pagos = tables.find((t) => t.name === "Pagos_Paciente");
  if (!pagos) {
    console.error("✖ Pagos_Paciente no existe. Ejecuta primero sprint131-create-pagos-paciente.ts");
    process.exit(1);
  }
  const usuarios = tables.find((t) => t.name === "Usuarios");
  if (!usuarios) {
    console.error("✖ Usuarios no encontrada.");
    process.exit(1);
  }
  const presupuestos = tables.find((t) => t.name === "Presupuestos");
  if (!presupuestos) {
    console.error("✖ Presupuestos no encontrada.");
    process.exit(1);
  }

  // ── Pagos_Paciente.Paciente_RecordId ─────────────────────────────────
  const r1 = await ensureField(pagos, {
    name: "Paciente_RecordId",
    type: "singleLineText",
    description:
      "Sprint 14a — record id del Paciente_Link[0] como texto plano. Permite filterByFormula directo evitando el bug ARRAYJOIN/primary field detectado en Sprint 13.1.1.",
  });
  console.log(`  Pagos_Paciente.Paciente_RecordId: ${r1}`);

  // ── Pagos_Paciente.Usuario_Creador ───────────────────────────────────
  const r2 = await ensureField(pagos, {
    name: "Usuario_Creador",
    type: "multipleRecordLinks",
    options: { linkedTableId: usuarios.id },
    description:
      "Sprint 14a — usuario Fyllio que registro el pago. Airtable createdBy con API token no sirve para auditoria real.",
  });
  console.log(`  Pagos_Paciente.Usuario_Creador: ${r2}`);

  // ── Presupuestos.Fecha_Aceptado ──────────────────────────────────────
  const r3 = await ensureField(presupuestos, {
    name: "Fecha_Aceptado",
    type: "date",
    options: { dateFormat: { name: "iso" } },
    description:
      "Sprint 14a — fecha en que el presupuesto paso a Estado=Aceptado. Null para presupuestos legacy aceptados sin fecha (la heuristica de urgencia lo maneja).",
  });
  console.log(`  Presupuestos.Fecha_Aceptado: ${r3}`);

  console.log(`✔ Schema migrations aplicadas en ${target}.`);
  if (target === "Dev") {
    console.log("   Para Prod: AIRTABLE_BASE_ID=appfUJcyGnkZ16Fhr ... --apply-prod");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
