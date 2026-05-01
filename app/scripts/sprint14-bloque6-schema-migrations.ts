// app/scripts/sprint14-bloque6-schema-migrations.ts
//
// Sprint 14a Bloque 6 — schema migrations en Airtable via Metadata API.
// Idempotente.
//
// Cambios:
//
//  Tabla nueva Acciones_Pago — auditoria de operaciones CRUD sobre
//  Pagos_Paciente. Permite trazabilidad post-mortem para contabilidad.
//    - Resumen          singleLineText (primary, rellenado por codigo)
//    - Pago_Link        multipleRecordLinks → Pagos_Paciente
//    - Tipo             singleSelect (Crear, Editar, Eliminar, Reembolsar)
//    - Importe_Antes    currency (null en Crear)
//    - Importe_Despues  currency (null en Eliminar)
//    - Usuario          multipleRecordLinks → Usuarios
//    - Fecha            dateTime
//    - Nota_Cambio      multilineText
//
//  Tabla nueva Inconsistencias_Pagos — log de fallos en sincronizacion
//  del cache Pacientes.Pagado. Endpoint admin /api/admin/reconciliar-pagos
//  las procesa.
//    - Resumen           singleLineText (primary)
//    - Pago_RecordId     singleLineText
//    - Paciente_RecordId singleLineText
//    - Error             multilineText
//    - Timestamp         dateTime
//    - Resuelto          checkbox
//
//  Pagos_Paciente.Tipo — enum re-scoped a 3 hitos comerciales.
//    Sprint 13.1: Pago_Unico, Cuota, Senal, Liquidacion.
//    Sprint 14 Bloque 6 (re-scoped): Senal, Primer_Pago_Plan, Liquidacion.
//
//    Solo añadimos Primer_Pago_Plan al singleSelect (Metadata API NO
//    permite eliminar choices de un select existente sin perder los
//    records que las usan). Tras el backfill (siguiente commit), las
//    opciones Pago_Unico y Cuota quedan huerfanas (sin records). Borrar
//    manualmente desde UI Airtable si se desea.
//
// Uso:
//   npx tsx app/scripts/sprint14-bloque6-schema-migrations.ts
//   AIRTABLE_BASE_ID=appfUJcyGnkZ16Fhr npx tsx ... --apply-prod

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

type Choice = { id?: string; name: string; color?: string };
type FieldMeta = {
  id: string;
  name: string;
  type: string;
  options?: { choices?: Choice[]; linkedTableId?: string };
};
type TableMeta = { id: string; name: string; fields: FieldMeta[] };

async function fetchSchema(): Promise<TableMeta[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`fetch schema: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { tables: TableMeta[] }).tables;
}

async function createTable(name: string, description: string, fields: any[]) {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, fields }),
  });
  if (!res.ok) {
    throw new Error(`crear tabla ${name}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function updateField(tableId: string, fieldId: string, body: any) {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${fieldId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`update field: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 14a Bloque 6 — schema migrations · base ${BASE_ID} (${target})`);

  let tables = await fetchSchema();
  const pagos = tables.find((t) => t.name === "Pagos_Paciente");
  const usuarios = tables.find((t) => t.name === "Usuarios");
  if (!pagos) throw new Error("Pagos_Paciente no existe (Sprint 13.1).");
  if (!usuarios) throw new Error("Usuarios no existe (Sprint 7).");

  // ── Acciones_Pago ────────────────────────────────────────────────────
  if (tables.find((t) => t.name === "Acciones_Pago")) {
    console.log("  Acciones_Pago: exists");
  } else {
    await createTable(
      "Acciones_Pago",
      "Sprint 14a Bloque 6 — auditoria de operaciones CRUD sobre Pagos_Paciente.",
      [
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Pago_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: pagos.id },
        },
        {
          name: "Tipo",
          type: "singleSelect",
          options: {
            choices: [
              { name: "Crear", color: "greenBright" },
              { name: "Editar", color: "yellowBright" },
              { name: "Eliminar", color: "redBright" },
              { name: "Reembolsar", color: "purpleBright" },
            ],
          },
        },
        { name: "Importe_Antes", type: "currency", options: { precision: 2, symbol: "€" } },
        { name: "Importe_Despues", type: "currency", options: { precision: 2, symbol: "€" } },
        {
          name: "Usuario",
          type: "multipleRecordLinks",
          options: { linkedTableId: usuarios.id },
        },
        { name: "Fecha", type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "Europe/Madrid" } },
        { name: "Nota_Cambio", type: "multilineText" },
      ],
    );
    console.log("  Acciones_Pago: created");
  }

  // ── Inconsistencias_Pagos ────────────────────────────────────────────
  if (tables.find((t) => t.name === "Inconsistencias_Pagos")) {
    console.log("  Inconsistencias_Pagos: exists");
  } else {
    await createTable(
      "Inconsistencias_Pagos",
      "Sprint 14a Bloque 6 — log de fallos en sincronizacion del cache Pacientes.Pagado tras crear/editar/eliminar pagos.",
      [
        { name: "Resumen", type: "singleLineText" },
        { name: "Pago_RecordId", type: "singleLineText" },
        { name: "Paciente_RecordId", type: "singleLineText" },
        { name: "Error", type: "multilineText" },
        { name: "Timestamp", type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "Europe/Madrid" } },
        { name: "Resuelto", type: "checkbox", options: { color: "greenBright", icon: "check" } },
      ],
    );
    console.log("  Inconsistencias_Pagos: created");
  }

  // ── Pagos_Paciente.Tipo: nota sobre extension del enum ──────────────
  // Metadata API NO permite modificar choices de un singleSelect ya
  // existente (el endpoint PATCH /fields/{id} solo cambia name y
  // description). Workaround: el SDK acepta `{typecast:true}` en
  // create/update y Airtable crea la opcion automaticamente al
  // recibir el primer record con un valor nuevo.
  //
  // El backfill (siguiente commit) lo hace: al actualizar pagos
  // legacy con typecast a "Primer_Pago_Plan", Airtable extiende el
  // enum. El crearPago en lib/pagos.ts tambien usa typecast.
  console.log("  Pagos_Paciente.Tipo: extension via typecast en backfill (no via Metadata API).");

  console.log(`✔ Schema migrations Bloque 6 aplicadas en ${target}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
