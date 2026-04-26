// app/scripts/sprint10-create-plantillas-lead.ts
//
// Sprint 10 D — crea la tabla Plantillas_Lead vía Metadata API + seed de
// 6 plantillas iniciales. Decisión cerrada con Simon: globales (sin
// campo Clínica). Si una clínica pide variantes, lo añadimos en Sprint 11.
//
// Idempotente:
//  - Si la tabla ya existe, no la recrea.
//  - Si una plantilla con el mismo Nombre ya existe, la salta.
//
// Uso: npx tsx app/scripts/sprint10-create-plantillas-lead.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}

type PlantillaSeed = {
  nombre: string;
  tipo:
    | "Primer_Contacto"
    | "Recordatorio_Cita"
    | "Reactivacion_NoAsistio"
    | "Seguimiento_SinRespuesta";
  contenido: string;
};

const PLANTILLAS: PlantillaSeed[] = [
  {
    nombre: "Primer contacto · genérico",
    tipo: "Primer_Contacto",
    contenido:
      "Hola {nombre}, te escribo de {clinica}. Hemos recibido tu solicitud de información sobre {tratamiento}. ¿Cuándo te viene bien que hablemos para resolver tus dudas?",
  },
  {
    nombre: "Primer contacto · ortodoncia",
    tipo: "Primer_Contacto",
    contenido:
      "Hola {nombre}, soy del equipo de {clinica}. Vi tu interés en ortodoncia. Trabajamos con varias técnicas (brackets y alineadores transparentes) y la primera valoración es gratuita. ¿Te paso huecos esta semana?",
  },
  {
    nombre: "Recordatorio cita · 24h antes",
    tipo: "Recordatorio_Cita",
    contenido:
      "Hola {nombre}, te recordamos tu cita en {clinica} mañana, {fecha_cita}. Si necesitas cambiar la hora, dímelo y lo organizamos.",
  },
  {
    nombre: "Recordatorio cita · día de",
    tipo: "Recordatorio_Cita",
    contenido:
      "Buenos días {nombre}, te esperamos hoy en {clinica} para tu cita de {tratamiento} a las {fecha_cita}. ¡Hasta ahora!",
  },
  {
    nombre: "Reactivación tras no asistir",
    tipo: "Reactivacion_NoAsistio",
    contenido:
      "Hola {nombre}, vimos que ayer no pudiste pasarte por {clinica} por tu cita de {tratamiento}. ¿Quieres que la reagendemos para esta semana? Tenemos huecos disponibles.",
  },
  {
    nombre: "Seguimiento sin respuesta · 48h",
    tipo: "Seguimiento_SinRespuesta",
    contenido:
      "Hola {nombre}, ¿qué tal? Te escribí hace un par de días sobre {tratamiento}. ¿Hay algo que pueda aclararte para ayudarte a decidir?",
  },
];

async function main() {
  // 1) Crear tabla si no existe.
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!tablesRes.ok) throw new Error(`tables ${tablesRes.status}`);
  const data = (await tablesRes.json()) as {
    tables: Array<{ id: string; name: string }>;
  };
  const yaExiste = data.tables.find((t) => t.name === "Plantillas_Lead");
  if (yaExiste) {
    console.log(`✔ Plantillas_Lead ya existe: ${yaExiste.id}`);
  } else {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Plantillas_Lead",
        description:
          "Sprint 10 D — plantillas de WhatsApp para leads. Globales (sin clínica). Placeholders {nombre} {clinica} {tratamiento} {fecha_cita}.",
        fields: [
          { name: "Nombre", type: "singleLineText" },
          {
            name: "Tipo",
            type: "singleSelect",
            options: {
              choices: [
                { name: "Primer_Contacto", color: "blueBright" },
                { name: "Recordatorio_Cita", color: "tealBright" },
                { name: "Reactivacion_NoAsistio", color: "yellowBright" },
                { name: "Seguimiento_SinRespuesta", color: "purpleBright" },
              ],
            },
          },
          { name: "Contenido", type: "multilineText" },
          { name: "Activa", type: "checkbox", options: { color: "greenBright", icon: "check" } },
        ],
      }),
    });
    if (!res.ok) throw new Error(`crear Plantillas_Lead: ${res.status} ${await res.text()}`);
    const created = await res.json();
    console.log(`✔ Plantillas_Lead creada: ${created.id}`);
  }

  // 2) Seed de plantillas si no existen ya por nombre.
  const existing = await fetchAll(
    base("Plantillas_Lead" as any).select({ fields: ["Nombre"] }),
  );
  const existingNames = new Set(
    existing.map((r) => String((r.fields as any)?.["Nombre"] ?? "")),
  );

  const toCreate = PLANTILLAS.filter((p) => !existingNames.has(p.nombre)).map((p) => ({
    fields: {
      Nombre: p.nombre,
      Tipo: p.tipo,
      Contenido: p.contenido,
      Activa: true,
    },
  }));
  if (toCreate.length === 0) {
    console.log("✔ Todas las plantillas seed ya existen");
    return;
  }
  await base("Plantillas_Lead" as any).create(toCreate as any, { typecast: true });
  console.log(`✔ ${toCreate.length} plantillas seed creadas`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
