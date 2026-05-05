// app/scripts/sprint16b-seed-reglas.ts
//
// Sprint 16b Bloque 2 — seed de las 5 reglas globales (Clinica_Link=null)
// + 3 plantillas WhatsApp nuevas en Configuraciones_Clinica.
//
// Idempotente: si una regla con el mismo Codigo ya existe, no se duplica.
//
// Uso: npx tsx app/scripts/sprint16b-seed-reglas.ts [--apply-prod]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import Airtable from "airtable";
import type {
  Accion,
  Condicion,
  TriggerTipo,
} from "../lib/automatizaciones/types";

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

const base = new Airtable({ apiKey: KEY }).base(BASE_ID);

type Regla = {
  codigo: string;
  nombre: string;
  descripcion: string;
  triggerTipo: TriggerTipo;
  condiciones: Condicion[];
  acciones: Accion[];
};

const REGLAS: Regla[] = [
  {
    codigo: "recordatorio_cita_24h",
    nombre: "Recordatorio de cita 24h antes",
    descripcion:
      "Envía un WhatsApp al paciente 24h antes de su cita confirmada. Reduce no-shows.",
    triggerTipo: "cita_confirmada_24h_antes",
    condiciones: [
      { campo: "estado", operador: "eq", valor: "Confirmada" },
    ],
    acciones: [
      {
        tipo: "enviar_whatsapp_template",
        params: {
          template_id: "recordatorio_cita_24h",
          variables_map: {
            nombre_paciente: "{{paciente.nombre}}",
            fecha_cita: "{{cita.fecha}}",
            hora_cita: "{{cita.hora}}",
            doctor_nombre: "{{doctor.nombre}}",
            clinica_nombre: "{{clinica.nombre}}",
          },
        },
      },
    ],
  },
  {
    codigo: "lead_sin_gestionar_2h",
    nombre: "Lead sin gestionar más de 2 horas",
    descripcion:
      "Avisa a la coordinadora cuando un lead nuevo lleva >2h sin contactar (en horario laboral).",
    triggerTipo: "lead_creado",
    condiciones: [
      { campo: "estado", operador: "eq", valor: "Nuevo" },
    ],
    acciones: [
      {
        tipo: "crear_alerta_coordinadora",
        params: {
          tipo_alerta: "lead_sin_gestionar",
          mensaje:
            "Lead {{lead.nombre}} sin gestionar hace 2h. Origen: {{lead.canal}}.",
          urgencia: "alta",
        },
      },
    ],
  },
  {
    codigo: "lead_inactivo_n_dias",
    nombre: "Lead inactivo N días → No Interesado",
    descripcion:
      "Mueve a No_Interesado leads en estado Contactado/Sin_Respuesta sin actividad en N días (default 60). El parámetro dias_inactividad se edita por clínica desde el panel.",
    triggerTipo: "lead_inactivo_n_dias",
    condiciones: [
      {
        campo: "estado",
        operador: "in",
        valor: ["Contactado", "Sin_Respuesta"],
      },
      {
        campo: "diasSinActividad",
        operador: "gte",
        valor: 60,
      },
    ],
    acciones: [
      {
        tipo: "actualizar_estado_lead",
        params: { nuevo_estado: "No_Interesado", razon: "automatica_inactividad" },
      },
      {
        tipo: "crear_accion_lead",
        params: {
          tipo: "automatica",
          descripcion:
            "Movido a No Interesado tras {{diasSinActividad}} días sin actividad.",
        },
      },
    ],
  },
  {
    codigo: "plantilla_post_presupuesto",
    nombre: "WhatsApp tras presentar presupuesto",
    descripcion:
      "Envía un WhatsApp con resumen + opciones de pago al paciente cuando el presupuesto pasa a Presentado.",
    triggerTipo: "presupuesto_presentado",
    condiciones: [
      { campo: "estado", operador: "eq", valor: "PRESENTADO" },
    ],
    acciones: [
      {
        tipo: "enviar_whatsapp_template",
        params: {
          template_id: "presupuesto_presentado",
          variables_map: {
            nombre_paciente: "{{paciente.nombre}}",
            lista_tratamientos: "{{presupuesto.tratamientos}}",
            total_presupuesto: "{{presupuesto.total}}",
            opciones_pago: "{{clinica.metodos_pago}}",
          },
        },
      },
    ],
  },
  {
    codigo: "presupuesto_estancado_7d",
    nombre: "Nudge a presupuesto estancado >7 días",
    descripcion:
      "WhatsApp de seguimiento cuando un presupuesto en En_Negociacion lleva >7 días sin actividad y no se le ha enviado nudge en los últimos 14d.",
    triggerTipo: "presupuesto_estancado_7d",
    condiciones: [
      { campo: "estado", operador: "eq", valor: "EN_NEGOCIACION" },
    ],
    acciones: [
      {
        tipo: "enviar_whatsapp_template",
        params: {
          template_id: "nudge_presupuesto_estancado",
          variables_map: {
            nombre_paciente: "{{paciente.nombre}}",
            tratamientos: "{{presupuesto.tratamientos}}",
            presupuesto_id: "{{presupuesto.id}}",
          },
        },
      },
    ],
  },
];

const PLANTILLAS_WA = [
  {
    nombre: "recordatorio_cita_24h",
    cuerpo: [
      "Hola {{nombre_paciente}} 👋",
      "",
      "Te recordamos tu cita en {{clinica_nombre}} mañana {{fecha_cita}} a las {{hora_cita}} con {{doctor_nombre}}.",
      "",
      "Si necesitas modificarla, respóndenos a este mensaje. ¡Te esperamos!",
    ].join("\n"),
  },
  {
    nombre: "presupuesto_presentado",
    cuerpo: [
      "Hola {{nombre_paciente}} 👋",
      "",
      "Adjunto resumen del presupuesto que comentamos:",
      "",
      "Tratamientos: {{lista_tratamientos}}",
      "Total: {{total_presupuesto}}€",
      "",
      "Opciones de pago disponibles: {{opciones_pago}}.",
      "",
      "Si tienes dudas o quieres revisar algún punto, escríbenos cuando te venga bien.",
    ].join("\n"),
  },
  {
    nombre: "nudge_presupuesto_estancado",
    cuerpo: [
      "Hola {{nombre_paciente}} 👋",
      "",
      "Quería retomar el presupuesto que vimos para {{tratamientos}}. ¿Quedó alguna duda que pueda resolverte?",
      "",
      "Tómate el tiempo que necesites — quería asegurarme de que no se queda en el aire.",
    ].join("\n"),
  },
];

async function reglaExiste(codigo: string): Promise<boolean> {
  const recs = await base("Reglas_Automatizacion")
    .select({
      filterByFormula: `{Codigo} = "${codigo}"`,
      maxRecords: 1,
    })
    .firstPage();
  return recs.length > 0;
}

async function plantillaExiste(nombre: string): Promise<boolean> {
  const recs = await base("Plantillas_Mensaje")
    .select({
      filterByFormula: `{Nombre} = "${nombre}"`,
      maxRecords: 1,
    })
    .firstPage();
  return recs.length > 0;
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 16b Bloque 2 — seed reglas + plantillas · base ${BASE_ID} (${target})`);

  // ── Reglas ──
  for (const r of REGLAS) {
    if (await reglaExiste(r.codigo)) {
      console.log(`  regla ${r.codigo}: exists`);
      continue;
    }
    const now = new Date().toISOString();
    await base("Reglas_Automatizacion").create(
      [
        {
          fields: {
            Resumen: r.nombre,
            Codigo: r.codigo,
            Nombre: r.nombre,
            Descripcion: r.descripcion,
            Trigger_Tipo: r.triggerTipo,
            Condiciones: JSON.stringify(r.condiciones),
            Acciones: JSON.stringify(r.acciones),
            Activa: true,
            Modo_Test: false,
            Veces_Disparada: 0,
            Created_At: now,
            Updated_At: now,
          },
        },
      ],
      { typecast: true },
    );
    console.log(`  regla ${r.codigo}: created`);
  }

  // ── Plantillas WA globales (Clinica_Link=null) ──
  for (const p of PLANTILLAS_WA) {
    if (await plantillaExiste(p.nombre)) {
      console.log(`  plantilla ${p.nombre}: exists`);
      continue;
    }
    await base("Plantillas_Mensaje").create(
      [
        {
          fields: {
            Nombre: p.nombre,
            Tipo: "Automatizacion",
            Categoria: "automatizacion",
            Contenido: p.cuerpo,
            Activa: true,
            Fecha_creacion: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
    console.log(`  plantilla ${p.nombre}: created`);
  }

  console.log("✔ Sprint 16b Bloque 2 seed OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
