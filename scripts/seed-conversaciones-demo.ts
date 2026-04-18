/**
 * scripts/seed-conversaciones-demo.ts
 * Genera conversaciones de demo para enriquecer la vista de WhatsApp.
 * SOLO para demo — NO es un migrador de datos reales.
 *
 * Crea conversaciones de múltiples mensajes para un subconjunto de presupuestos
 * que ya tienen datos en la cola de intervención.
 *
 * Uso:
 *   npx tsx scripts/seed-conversaciones-demo.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ───────────────────────────────────────────────────────────
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

import Airtable from "airtable";

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const PRESUPUESTOS = "Presupuestos";
const MENSAJES = "Mensajes_WhatsApp";
const BATCH_SIZE = 10;
const DELAY_MS = 250;
const MAX_PRESUPUESTOS = 10; // Only seed a subset

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllRecords(table: string, options: Record<string, unknown>): Promise<any[]> {
  const records: any[] = [];
  await new Promise<void>((resolve, reject) => {
    (base(table) as any)
      .select(options)
      .eachPage(
        (pageRecords: any[], nextPage: () => void) => {
          records.push(...pageRecords);
          nextPage();
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
  });
  return records;
}

// Demo conversations — realistic dental clinic WhatsApp exchanges
const CONVERSACIONES_DEMO: {
  intencion: string;
  mensajes: { dir: "Entrante" | "Saliente"; contenido: string; offsetHours: number }[];
}[] = [
  {
    intencion: "Acepta pero pregunta pago",
    mensajes: [
      { dir: "Saliente", contenido: "Buenos días María, le escribo desde la clínica. Le enviamos el presupuesto del tratamiento de implantes que comentamos en su visita. Quedo a su disposición para cualquier consulta.", offsetHours: -72 },
      { dir: "Entrante", contenido: "Hola buenas tardes. Sí lo he visto. Me parece bien el tratamiento pero quería preguntar si se puede financiar o pagar en varias veces?", offsetHours: -48 },
      { dir: "Saliente", contenido: "Por supuesto María. Ofrecemos financiación hasta 24 meses sin intereses. Le puedo preparar un plan de pago personalizado si me confirma que desea seguir adelante.", offsetHours: -24 },
      { dir: "Entrante", contenido: "Ah perfecto, eso me viene muy bien. Sí me interesa, podemos hablar la semana que viene?", offsetHours: -6 },
    ],
  },
  {
    intencion: "Tiene duda sobre tratamiento",
    mensajes: [
      { dir: "Saliente", contenido: "Buenas tardes Carlos, le adjunto el presupuesto de la endodoncia que necesita en la pieza 36. Si tiene alguna duda estoy a su disposición.", offsetHours: -96 },
      { dir: "Entrante", contenido: "Hola gracias. Tengo una pregunta, cuanto dura el tratamiento? Es que tengo miedo que duela mucho", offsetHours: -72 },
      { dir: "Saliente", contenido: "Entiendo su preocupación Carlos. La endodoncia dura entre 45-60 minutos y se realiza con anestesia local, por lo que no sentirá dolor durante el procedimiento. Después puede haber alguna molestia leve que se controla con analgésicos.", offsetHours: -48 },
      { dir: "Entrante", contenido: "Vale gracias por la explicación. Y después hay que poner corona o algo?", offsetHours: -24 },
    ],
  },
  {
    intencion: "Pide oferta/descuento",
    mensajes: [
      { dir: "Saliente", contenido: "Hola Ana, espero que esté bien. Le recuerdo que tiene pendiente el presupuesto de ortodoncia invisible que le preparamos.", offsetHours: -120 },
      { dir: "Entrante", contenido: "Sí hola. Mira he estado mirando en otras clínicas y me dan precios más bajos. Podéis hacer algo con el precio?", offsetHours: -96 },
      { dir: "Saliente", contenido: "Ana, entiendo que el precio es un factor importante. Nuestro presupuesto incluye todas las revisiones, retenedores y el seguimiento completo. Le puedo consultar si hay alguna promoción vigente.", offsetHours: -72 },
      { dir: "Entrante", contenido: "Ok avísame entonces. Pero necesitaría que bajase al menos un 10%", offsetHours: -48 },
      { dir: "Saliente", contenido: "He consultado con dirección y podemos ofrecerle un 5% de descuento si confirma esta semana. Además incluimos el blanqueamiento de regalo al finalizar el tratamiento.", offsetHours: -24 },
    ],
  },
  {
    intencion: "Quiere pensarlo",
    mensajes: [
      { dir: "Saliente", contenido: "Buenos días Pedro, le escribo para hacerle seguimiento del presupuesto de las carillas de porcelana. Ha tenido oportunidad de revisarlo?", offsetHours: -168 },
      { dir: "Entrante", contenido: "Hola sí lo vi. Es bastante dinero la verdad, necesito pensarlo bien con mi mujer", offsetHours: -144 },
      { dir: "Saliente", contenido: "Lo entiendo perfectamente Pedro. Tómese el tiempo que necesite. Si quiere, pueden venir los dos a la clínica y el doctor les explica el proceso en detalle, sin compromiso.", offsetHours: -120 },
      { dir: "Entrante", contenido: "Vale se lo comento a ella y os digo algo. Gracias", offsetHours: -96 },
    ],
  },
  {
    intencion: "Acepta sin condiciones",
    mensajes: [
      { dir: "Saliente", contenido: "Buenas tardes Laura, le envío el presupuesto de la limpieza profunda y empastes que necesita. Cualquier duda estamos a su disposición.", offsetHours: -48 },
      { dir: "Entrante", contenido: "Hola! Perfecto, está bien el precio. Cuándo me podéis dar cita?", offsetHours: -24 },
      { dir: "Saliente", contenido: "Estupendo Laura. Tenemos disponibilidad el jueves a las 10:00 o el viernes a las 16:30. Cuál le viene mejor?", offsetHours: -12 },
      { dir: "Entrante", contenido: "El viernes a las 16:30 perfecto!", offsetHours: -6 },
    ],
  },
];

async function main() {
  console.log("Cargando presupuestos con datos de intervención...");

  const presupuestos = await fetchAllRecords(PRESUPUESTOS, {
    fields: [
      "Paciente_nombre",
      "Paciente_Telefono",
      "Teléfono",
      "Intencion_detectada",
    ],
    filterByFormula: `AND({Intencion_detectada}!='', {Estado}!='ACEPTADO', {Estado}!='PERDIDO')`,
    maxRecords: MAX_PRESUPUESTOS,
  });

  console.log(`Encontrados ${presupuestos.length} presupuestos candidatos.`);

  if (presupuestos.length === 0) {
    console.log("No hay presupuestos con intervención activa. Ejecuta primero el seed de intervención.");
    return;
  }

  const batch: Record<string, unknown>[] = [];
  let totalCreados = 0;
  const now = Date.now();

  for (let i = 0; i < presupuestos.length; i++) {
    const rec = presupuestos[i];
    const f = rec.fields as Record<string, unknown>;
    const presupuestoId = rec.id;

    const telefono = f["Paciente_Telefono"]
      ? String(f["Paciente_Telefono"])
      : Array.isArray(f["Teléfono"])
        ? String((f["Teléfono"] as string[])[0] ?? "")
        : String(f["Teléfono"] ?? "");

    // Pick a conversation template (cycle through them)
    const conv = CONVERSACIONES_DEMO[i % CONVERSACIONES_DEMO.length];

    for (const msg of conv.mensajes) {
      const timestamp = new Date(now + msg.offsetHours * 60 * 60 * 1000).toISOString();
      batch.push({
        fields: {
          Presupuesto: presupuestoId,
          Telefono: telefono,
          Direccion: msg.dir,
          Contenido: msg.contenido,
          Timestamp: timestamp,
          Fuente: "Modo_A_manual",
          Procesado_por_IA: false,
        },
      });
    }

    // Flush batch if full
    while (batch.length >= BATCH_SIZE) {
      const chunk = batch.splice(0, BATCH_SIZE);
      await (base(MENSAJES) as any).create(chunk);
      totalCreados += chunk.length;
      console.log(`  Creados ${totalCreados} mensajes de demo...`);
      await sleep(DELAY_MS);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await (base(MENSAJES) as any).create(batch);
    totalCreados += batch.length;
  }

  console.log(`\nSeed completado: ${totalCreados} mensajes de demo creados para ${presupuestos.length} presupuestos.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
