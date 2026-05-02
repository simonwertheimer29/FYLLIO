// app/scripts/sprint14b-bloque4-plantillas.ts
//
// Sprint 14b Bloque 4 — schema migration + seed de las 3 plantillas
// globales de cobranza.
//
// Cambios schema (Plantillas_Mensaje, idempotente):
//
//  - Categoria  singleSelect: cobranza, lead_seguimiento, cita_recordatorio.
//                Si no existe se crea como nuevo field. (El campo legacy
//                "Tipo" sigue siendo el clasificador antiguo —
//                "Primer contacto", "Recordatorio", etc. — y se queda
//                para no romper referencias hasta Sprint 15.)
//  - Variables_Detectadas  multilineText. Auto-poblado por la lib al
//                guardar (parsing de {{var}} del Contenido). Sirve para
//                preview rapido sin re-parsear cada vez.
//
// Plantillas globales (Clinica_Link=null) en Categoria=cobranza:
//   recordatorio_senal
//   recordatorio_primer_pago
//   recordatorio_liquidacion
//
// Backfill: plantillas existentes que no tengan Categoria reciben
// 'lead_seguimiento' por defecto (semantica: estan asociadas al embudo
// pre-cobro).

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";
if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error("✖ Prod requiere --apply-prod explicito.");
  process.exit(1);
}

type FieldMeta = { id: string; name: string; type: string; options?: any };
type TableMeta = { id: string; name: string; fields: FieldMeta[] };

async function fetchSchema(): Promise<TableMeta[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
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
  if (!res.ok) throw new Error(`add field: ${res.status} ${await res.text()}`);
}

const PLANTILLAS_GLOBALES_COBRANZA = [
  {
    nombre: "recordatorio_senal",
    contenido:
      "Hola {{nombre}}, soy {{nombre_doctor}} de {{nombre_clinica}}. " +
      "Confirmamos tu presupuesto de {{importe}}€ para {{tratamiento}}. " +
      "Para reservar tu plaza, ¿podrías abonar la señal? Cualquier duda, aquí estamos.",
  },
  {
    nombre: "recordatorio_primer_pago",
    contenido:
      "Hola {{nombre}}, ¿cómo estás? Te recuerdo que tienes pendiente el primer " +
      "pago de tu plan de tratamiento ({{importe}}€). ¿Cuándo te viene bien pasar " +
      "por la clínica? Te esperamos.",
  },
  {
    nombre: "recordatorio_liquidacion",
    contenido:
      "Hola {{nombre}}, soy {{nombre_doctor}}. Tienes pendiente la liquidación de " +
      "{{importe}}€ desde hace {{dias_vencido}} días. ¿Hay algo en lo que pueda " +
      "ayudarte? Llámanos cuando quieras.",
  },
];

function extractVariables(contenido: string): string[] {
  const re = /\{\{([a-zA-Z_]+)\}\}/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido)) !== null) found.add(m[1]!);
  return Array.from(found).sort();
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 14b Bloque 4 — schema + seed cobranza · base ${BASE_ID} (${target})`);

  // Necesitamos importar Airtable al vuelo (no lo usamos arriba para
  // evitar pull innecesario antes del guard de Prod).
  const { default: Airtable } = await import("airtable");
  Airtable.configure({ apiKey: KEY });
  const baseAt = Airtable.base(BASE_ID);

  let tables = await fetchSchema();
  const plantillas = tables.find((t) => t.name === "Plantillas_Mensaje");
  if (!plantillas) throw new Error("Plantillas_Mensaje no existe.");

  // ── Field Categoria ─────────────────────────────────────────────
  if (plantillas.fields.find((f) => f.name === "Categoria")) {
    console.log("  Plantillas_Mensaje.Categoria: exists");
  } else {
    await addField(plantillas.id, {
      name: "Categoria",
      type: "singleSelect",
      options: {
        choices: [
          { name: "cobranza", color: "redBright" },
          { name: "lead_seguimiento", color: "blueBright" },
          { name: "cita_recordatorio", color: "yellowBright" },
        ],
      },
      description:
        "Sprint 14b Bloque 4 — categoria de la plantilla. cobranza usa el flujo de recordatorios de pago.",
    });
    console.log("  Plantillas_Mensaje.Categoria: added");
  }

  // ── Field Variables_Detectadas ──────────────────────────────────
  if (plantillas.fields.find((f) => f.name === "Variables_Detectadas")) {
    console.log("  Plantillas_Mensaje.Variables_Detectadas: exists");
  } else {
    await addField(plantillas.id, {
      name: "Variables_Detectadas",
      type: "multilineText",
      description:
        "Sprint 14b Bloque 4 — auto-poblado: lista CSV de variables {{var}} encontradas en Contenido. Sirve para preview rapido sin re-parsear cada vez.",
    });
    console.log("  Plantillas_Mensaje.Variables_Detectadas: added");
  }

  // ── Backfill Categoria='lead_seguimiento' en plantillas existentes ─
  // Refresh schema y ver records sin Categoria.
  tables = await fetchSchema();
  const plantillasFresh = tables.find((t) => t.name === "Plantillas_Mensaje")!;
  const tienePresentCat = plantillasFresh.fields.find((f) => f.name === "Categoria");
  if (!tienePresentCat) throw new Error("Categoria no se aplico tras add field.");

  const allRecs = await new Promise<any[]>((resolve, reject) => {
    const acc: any[] = [];
    baseAt(plantillasFresh.id)
      .select({ fields: ["Nombre", "Categoria", "Contenido"] })
      .eachPage(
        (page, next) => {
          acc.push(...page);
          next();
        },
        (err) => (err ? reject(err) : resolve(acc)),
      );
  });
  const sinCategoria = allRecs.filter((r) => !((r.fields as any) || {})["Categoria"]);
  if (sinCategoria.length === 0) {
    console.log("  Backfill Categoria: 0 plantillas pendientes (idempotente).");
  } else {
    console.log(`  Backfill Categoria='lead_seguimiento' en ${sinCategoria.length} plantillas...`);
    for (let i = 0; i < sinCategoria.length; i += 10) {
      const slice = sinCategoria.slice(i, i + 10);
      await baseAt(plantillasFresh.id).update(
        slice.map((r) => ({ id: r.id, fields: { Categoria: "lead_seguimiento" } })),
        { typecast: true },
      );
    }
    console.log(`  Backfill Categoria: ${sinCategoria.length} actualizadas.`);
  }

  // ── Crear 3 plantillas globales cobranza (idempotente) ─
  const existentesGlobales = allRecs.filter((r) => {
    const f = (r.fields as any) ?? {};
    const links = (f["Clinica_Link"] ?? []) as string[];
    return f["Categoria"] === "cobranza" && links.length === 0;
  });
  const yaExiste = (nombre: string) =>
    existentesGlobales.some(
      (r) => String(((r.fields as any) ?? {})["Nombre"] ?? "") === nombre,
    );
  const aCrear = PLANTILLAS_GLOBALES_COBRANZA.filter((p) => !yaExiste(p.nombre));
  if (aCrear.length === 0) {
    console.log(`  Plantillas cobranza globales: ${existentesGlobales.length}/${PLANTILLAS_GLOBALES_COBRANZA.length} ya existen. Idempotente.`);
  } else {
    console.log(`  Creando ${aCrear.length} plantillas cobranza globales...`);
    await baseAt(plantillasFresh.id).create(
      aCrear.map((p) => ({
        fields: {
          Nombre: p.nombre,
          Tipo: "Recordatorio",
          Categoria: "cobranza",
          Contenido: p.contenido,
          Variables_Detectadas: extractVariables(p.contenido).join(", "),
          Activa: true,
          Fecha_creacion: new Date().toISOString(),
        },
      })),
      { typecast: true },
    );
    console.log(`  ✔ ${aCrear.length} plantillas cobranza creadas.`);
  }

  console.log(`✔ Schema + seed Bloque 4 aplicados en ${target}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
