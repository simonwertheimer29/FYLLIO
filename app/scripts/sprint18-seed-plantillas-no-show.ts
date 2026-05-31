// app/scripts/sprint18-seed-plantillas-no-show.ts
//
// Sprint 18 Bloque 5 — seed de plantillas WhatsApp del motor de no-shows.
// Idempotente (chequea por Nombre global antes de crear).
//
// Plantillas (globales, Clinica_Link vacío, Categoria=cita_recordatorio):
//   - recordatorio_personalizado_alto_riesgo
//   - recordatorio_extra_2h_antes
//
// Solo usa variables soportadas por renderizarPlantilla:
//   {{nombre}}, {{tratamiento}}, {{nombre_doctor}}, {{nombre_clinica}}
//
// Uso: npx tsx app/scripts/sprint18-seed-plantillas-no-show.ts [--apply-prod]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import Airtable from "airtable";

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";

if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}
if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error("✖ Prod requiere --apply-prod explicito.");
  process.exit(1);
}

const TABLE = "Plantillas_Mensaje";

const PLANTILLAS = [
  {
    nombre: "recordatorio_personalizado_alto_riesgo",
    contenido:
      "Hola {{nombre}} 👋 Te esperamos en {{nombre_clinica}} para tu cita de {{tratamiento}} con {{nombre_doctor}}. " +
      "Para nosotros es importante contar contigo. ¿Nos confirmas tu asistencia? " +
      "Si necesitas reagendar, escríbenos y lo resolvemos.",
  },
  {
    nombre: "recordatorio_extra_2h_antes",
    contenido:
      "Hola {{nombre}}, recordatorio: tu cita de {{tratamiento}} en {{nombre_clinica}} es muy pronto. " +
      "¿Estás en camino? Si surgió algo, escríbenos.",
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
  Airtable.configure({ apiKey: KEY });
  const base = Airtable.base(BASE_ID);

  // Plantillas globales existentes (Clinica_Link vacío) por nombre.
  const existing = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    base(TABLE)
      .select({ fields: ["Nombre", "Clinica_Link"] })
      .eachPage(
        (recs, next) => {
          for (const r of recs) {
            const links = (r.fields["Clinica_Link"] ?? []) as string[];
            if (links.length === 0) existing.add(String(r.fields["Nombre"] ?? ""));
          }
          next();
        },
        (err) => (err ? reject(err) : resolve()),
      );
  });

  let creadas = 0;
  let saltadas = 0;
  for (const p of PLANTILLAS) {
    if (existing.has(p.nombre)) {
      console.log(`  • ${p.nombre} ya existe → skip`);
      saltadas += 1;
      continue;
    }
    await base(TABLE).create(
      [
        {
          fields: {
            Nombre: p.nombre,
            Tipo: "Recordatorio",
            Categoria: "cita_recordatorio",
            Contenido: p.contenido,
            Variables_Detectadas: extractVariables(p.contenido).join(", "),
            Activa: true,
            Fecha_creacion: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
    console.log(`  ✓ creada: ${p.nombre}`);
    creadas += 1;
  }

  console.log(`▶ Plantillas no-show — creadas: ${creadas}, ya existían: ${saltadas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
