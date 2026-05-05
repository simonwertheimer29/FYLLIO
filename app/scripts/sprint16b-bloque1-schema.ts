// app/scripts/sprint16b-bloque1-schema.ts
//
// Sprint 16b Bloque 1 — schema motor de automatizaciones. Idempotente.
//
// Tablas nuevas:
//   - Reglas_Automatizacion: definiciones de reglas (5 globales seedadas
//     en Bloque 2; admin/coord pueden activar override por clinica).
//   - Acciones_Automatizacion: log auditoría de cada disparo + resultado.
//   - Eventos_Sistema: registro de eventos producidos por el código que
//     pueden disparar reglas (lead_creado, presupuesto_presentado, etc).
//
// Campos añadidos:
//   - Pacientes.Optout_Automatizaciones (checkbox).
//
// Categoría nueva en Configuraciones_Clinica:
//   - horario_laboral (clave Configuraciones_Clinica.Categoria nueva
//     enum value). El JSON con días + ventanas vive en `Valor`.
//
// Uso: npx tsx app/scripts/sprint16b-bloque1-schema.ts [--apply-prod]

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
  if (!res.ok) throw new Error(`add field ${field.name}: ${res.status} ${await res.text()}`);
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
  if (!res.ok) throw new Error(`update field: ${res.status} ${await res.text()}`);
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 16b Bloque 1 — schema · base ${BASE_ID} (${target})`);

  const tables = await fetchSchema();
  const clinicas = tables.find((t) => t.name === "Clínicas");
  const pacientes = tables.find((t) => t.name === "Pacientes");
  const leads = tables.find((t) => t.name === "Leads");
  const presupuestos = tables.find((t) => t.name === "Presupuestos");
  const configs = tables.find((t) => t.name === "Configuraciones_Clinica");
  if (!clinicas) throw new Error("Clínicas no existe.");
  if (!pacientes) throw new Error("Pacientes no existe.");
  if (!leads) throw new Error("Leads no existe.");
  if (!presupuestos) throw new Error("Presupuestos no existe.");
  if (!configs) throw new Error("Configuraciones_Clinica no existe.");

  // ── Reglas_Automatizacion ────────────────────────────────────────────
  let reglas = tables.find((t) => t.name === "Reglas_Automatizacion");
  if (reglas) {
    console.log("  Reglas_Automatizacion: exists");
  } else {
    await createTable(
      "Reglas_Automatizacion",
      "Sprint 16b — definiciones de reglas de automatización. Globales (Clinica_Link=null) + overrides por clinica.",
      [
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Clinica_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: clinicas.id },
        },
        { name: "Codigo", type: "singleLineText" },
        { name: "Nombre", type: "singleLineText" },
        { name: "Descripcion", type: "multilineText" },
        {
          name: "Trigger_Tipo",
          type: "singleSelect",
          options: {
            choices: [
              { name: "lead_creado", color: "blueBright" },
              { name: "cita_confirmada_24h_antes", color: "purpleBright" },
              { name: "presupuesto_presentado", color: "cyanBright" },
              { name: "presupuesto_estancado_7d", color: "yellowBright" },
              { name: "lead_inactivo_n_dias", color: "orangeBright" },
            ],
          },
        },
        { name: "Condiciones", type: "multilineText" },
        { name: "Acciones", type: "multilineText" },
        {
          name: "Activa",
          type: "checkbox",
          options: { color: "greenBright", icon: "check" },
        },
        { name: "Veces_Disparada", type: "number", options: { precision: 0 } },
        {
          name: "Ultima_Disparada_At",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "Europe/Madrid",
          },
        },
        {
          name: "Modo_Test",
          type: "checkbox",
          options: { color: "yellowBright", icon: "flag" },
        },
        { name: "Paciente_Test_Id", type: "singleLineText" },
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
      ],
    );
    console.log("  Reglas_Automatizacion: created");
    reglas = (await fetchSchema()).find((t) => t.name === "Reglas_Automatizacion")!;
  }

  // ── Acciones_Automatizacion ──────────────────────────────────────────
  if (tables.find((t) => t.name === "Acciones_Automatizacion")) {
    console.log("  Acciones_Automatizacion: exists");
  } else {
    await createTable(
      "Acciones_Automatizacion",
      "Sprint 16b — log auditoría de disparos del motor de automatizaciones.",
      [
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Regla_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: reglas!.id },
        },
        {
          name: "Paciente_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: pacientes.id },
        },
        {
          name: "Lead_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: leads.id },
        },
        {
          name: "Presupuesto_Link",
          type: "multipleRecordLinks",
          options: { linkedTableId: presupuestos.id },
        },
        {
          name: "Resultado",
          type: "singleSelect",
          options: {
            choices: [
              { name: "success", color: "greenBright" },
              { name: "error", color: "redBright" },
              { name: "skipped_cooldown", color: "yellowBright" },
              { name: "skipped_optout", color: "grayBright" },
              { name: "skipped_horario", color: "grayBright" },
              { name: "skipped_test", color: "grayBright" },
              { name: "skipped_dedupe", color: "grayBright" },
            ],
          },
        },
        { name: "Detalle", type: "multilineText" },
        {
          name: "Ejecutada_At",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "Europe/Madrid",
          },
        },
      ],
    );
    console.log("  Acciones_Automatizacion: created");
  }

  // ── Eventos_Sistema ──────────────────────────────────────────────────
  if (tables.find((t) => t.name === "Eventos_Sistema")) {
    console.log("  Eventos_Sistema: exists");
  } else {
    await createTable(
      "Eventos_Sistema",
      "Sprint 16b — registro de eventos del sistema que pueden disparar reglas. Procesados=true cuando el motor ya los evaluó.",
      [
        { name: "Resumen", type: "singleLineText" },
        {
          name: "Tipo",
          type: "singleSelect",
          options: {
            choices: [
              { name: "lead_creado", color: "blueBright" },
              { name: "cita_creada", color: "purpleBright" },
              { name: "presupuesto_creado", color: "cyanBright" },
              { name: "presupuesto_actualizado", color: "tealBright" },
            ],
          },
        },
        { name: "Entidad_Tipo", type: "singleLineText" },
        { name: "Entidad_Id", type: "singleLineText" },
        { name: "Payload", type: "multilineText" },
        {
          name: "Procesado",
          type: "checkbox",
          options: { color: "greenBright", icon: "check" },
        },
        {
          name: "Created_At",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "Europe/Madrid",
          },
        },
      ],
    );
    console.log("  Eventos_Sistema: created");
  }

  // ── Pacientes.Optout_Automatizaciones ────────────────────────────────
  if (pacientes.fields.find((f) => f.name === "Optout_Automatizaciones")) {
    console.log("  Pacientes.Optout_Automatizaciones: exists");
  } else {
    await addField(pacientes.id, {
      name: "Optout_Automatizaciones",
      type: "checkbox",
      options: { color: "redBright", icon: "check" },
    });
    console.log("  Pacientes.Optout_Automatizaciones: created");
  }

  // ── Configuraciones_Clinica.Categoria — horario_laboral ──────────────
  // Airtable Meta API NO permite extender choices de singleSelect via
  // PATCH (devuelve INVALID_REQUEST_UNKNOWN). Workaround: al crear
  // registros con la nueva categoría, usamos typecast:true en la
  // operación de write — Airtable auto-añade el choice. Documentado
  // aquí para que el seed de Bloque 2 lo recuerde.
  const cat = configs.fields.find((f) => f.name === "Categoria");
  const tieneHorario = cat?.options?.choices?.find(
    (c: any) => c.name === "horario_laboral",
  );
  if (tieneHorario) {
    console.log("  Configuraciones_Clinica.Categoria.horario_laboral: exists");
  } else {
    console.log(
      "  Configuraciones_Clinica.Categoria.horario_laboral: pending (se añadirá automáticamente vía typecast en el primer write del Bloque 2/5)",
    );
  }

  console.log("✔ Sprint 16b Bloque 1 schema OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
