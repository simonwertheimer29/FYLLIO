/**
 * scripts/seed-intervencion.ts
 * Seed realista para la Cola de Intervención.
 *
 * Pobla ~80 presupuestos activos con datos de intervención:
 * respuestas de pacientes variadas, intenciones, urgencias,
 * acciones sugeridas y mensajes IA pre-generados.
 *
 * Uso:
 *   npx tsx scripts/seed-intervencion.ts
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eqIdx = t.indexOf("=");
    if (eqIdx < 0) continue;
    const k = t.slice(0, eqIdx).trim();
    const v = t.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

// ── Tipos ────────────────────────────────────────────────────────────────────

type Intencion =
  | "Acepta sin condiciones"
  | "Acepta pero pregunta pago"
  | "Tiene duda sobre tratamiento"
  | "Pide oferta/descuento"
  | "Quiere pensarlo"
  | "Rechaza"
  | "Sin clasificar";

type Urgencia = "CRÍTICO" | "ALTO" | "MEDIO" | "BAJO" | "NINGUNO";

type Fase =
  | "Inicial"
  | "Recordatorio 3d"
  | "Recordatorio 7d"
  | "Esperando respuesta"
  | "En intervención";

type TipoAccion = "WhatsApp enviado" | "Llamada realizada" | "Mensaje recibido" | "Sin respuesta tras llamada";

interface Escenario {
  respuesta: string;
  intencion: Intencion;
  urgencia: Urgencia;
  accion: string;
  mensaje: string; // placeholder — {nombre} y {tratamiento} se reemplazan
  fase: Fase;
  tipoAccion?: TipoAccion;
  horasAtras: number; // cuántas horas atrás se registró la respuesta
}

// ── 25 escenarios realistas ──────────────────────────────────────────────────

const ESCENARIOS: Escenario[] = [
  // ── CRÍTICO: Acepta sin condiciones (3) ──
  {
    respuesta: "Vale, adelante. ¿Cuándo puedo ir a firmar?",
    intencion: "Acepta sin condiciones",
    urgencia: "CRÍTICO",
    accion: "Agendar cita de firma",
    mensaje: "Hola {nombre}, qué buena noticia. Te podemos recibir mañana o el jueves para firmar y planificar tu {tratamiento}. ¿Qué día te viene mejor?",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 2,
  },
  {
    respuesta: "ok si, lo quiero hacer. dime cuando empezamos",
    intencion: "Acepta sin condiciones",
    urgencia: "CRÍTICO",
    accion: "Llamar para agendar inicio",
    mensaje: "Hola {nombre}, nos alegramos mucho de tu decisión. Te llamamos hoy para coordinar la primera cita de tu {tratamiento}. ¿A qué hora te viene bien?",
    fase: "En intervención",
    horasAtras: 5,
  },
  {
    respuesta: "Perfecto, he decidido hacerlo. Solo necesito saber qué documentación traer el primer día",
    intencion: "Acepta sin condiciones",
    urgencia: "CRÍTICO",
    accion: "Enviar checklist documentación",
    mensaje: "{nombre}, estupendo que hayas decidido seguir adelante con tu {tratamiento}. Solo necesitas traer tu DNI y la tarjeta sanitaria. Te enviamos un recordatorio el día antes.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 1,
  },

  // ── CRÍTICO: Acepta pero pregunta pago (5) ──
  {
    respuesta: "Está bien, pero no sé qué financiación tenéis disponible",
    intencion: "Acepta pero pregunta pago",
    urgencia: "CRÍTICO",
    accion: "Enviar detalles de financiación",
    mensaje: "Hola {nombre}, tenemos varias opciones de financiación para tu {tratamiento}: desde 3 hasta 24 meses sin intereses. ¿Te llamo para explicarte las condiciones en detalle?",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 12,
  },
  {
    respuesta: "Vale, ¿cómo pago? ¿Se puede en plazos?",
    intencion: "Acepta pero pregunta pago",
    urgencia: "CRÍTICO",
    accion: "Enviar opciones de pago",
    mensaje: "{nombre}, por supuesto. Ofrecemos pago fraccionado sin intereses. Te paso las opciones por escrito para que puedas revisarlas con tranquilidad.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 3,
  },
  {
    respuesta: "si me interesa pero nesesito saber si aceptais tarjeta o tiene q ser transferencia pq yo cobro el dia 5",
    intencion: "Acepta pero pregunta pago",
    urgencia: "CRÍTICO",
    accion: "Informar métodos de pago",
    mensaje: "Hola {nombre}, aceptamos tarjeta, transferencia y efectivo. Podemos ajustar la domiciliación a tu fecha de cobro sin problema. ¿Quedamos para formalizar tu {tratamiento}?",
    fase: "En intervención",
    horasAtras: 8,
  },
  {
    respuesta: "Acepto el presupuesto. ¿Podéis facturar a nombre de mi empresa? Es para deducción fiscal",
    intencion: "Acepta pero pregunta pago",
    urgencia: "CRÍTICO",
    accion: "Confirmar facturación empresa",
    mensaje: "{nombre}, sí, podemos emitir factura a nombre de tu empresa sin problema. Envíanos los datos fiscales y preparamos todo para tu {tratamiento}.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 4,
  },
  {
    respuesta: "me parece bien el precio. puedo pagar la mitad ahora y la otra mitad cuando acabe?",
    intencion: "Acepta pero pregunta pago",
    urgencia: "CRÍTICO",
    accion: "Confirmar pago 50/50",
    mensaje: "Hola {nombre}, claro que sí. Podemos dividir el pago de tu {tratamiento} en dos: 50% al inicio y 50% al finalizar. Te llamo para cerrar la cita.",
    fase: "En intervención",
    horasAtras: 6,
  },

  // ── ALTO: Tiene duda sobre tratamiento (6) ──
  {
    respuesta: "He estado pensándolo y necesito saber si el precio incluye las radiografías de control del año siguiente, porque mi seguro me cubre parte",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Aclarar qué incluye el presupuesto",
    mensaje: "{nombre}, el presupuesto de tu {tratamiento} incluye todas las radiografías y revisiones del primer año. Si tu seguro cubre parte, podemos ajustar. ¿Hablamos para ver los detalles?",
    fase: "Esperando respuesta",
    tipoAccion: "Mensaje recibido",
    horasAtras: 24,
  },
  {
    respuesta: "¿Cuánto dura el tratamiento completo? Porque tengo un viaje en julio y no quiero que interfiera",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Dar timeline del tratamiento",
    mensaje: "Hola {nombre}, tu {tratamiento} tiene una duración aproximada de 4-6 semanas. Podemos planificar para que no coincida con tu viaje. ¿Cuándo es exactamente?",
    fase: "Esperando respuesta",
    horasAtras: 18,
  },
  {
    respuesta: "buenos dias, tengo una pregunta, ¿es doloroso? mi hermana se hizo algo parecido y dice q le dolio bastante",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Tranquilizar sobre dolor",
    mensaje: "{nombre}, entendemos tu preocupación. Con las técnicas actuales, tu {tratamiento} se realiza con anestesia local y la molestia posterior es mínima. Podemos explicarte el proceso paso a paso si te ayuda.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 10,
  },
  {
    respuesta: "Pero si me pongo los implantes, ¿puedo comer normal desde el primer día o hay restricciones?",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Explicar postoperatorio",
    mensaje: "Hola {nombre}, los primeros días tras tu {tratamiento} se recomienda dieta blanda, pero en 7-10 días podrás comer con normalidad. Te daremos una guía completa de cuidados postoperatorios.",
    fase: "Esperando respuesta",
    horasAtras: 36,
  },
  {
    respuesta: "una cosita, el material de la corona es porcelana o zirconio? pq he leido q el zirconio dura mas",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Explicar materiales disponibles",
    mensaje: "{nombre}, trabajamos con zirconio de última generación para las coronas, que es más resistente y estético. Tu presupuesto ya incluye este material. ¿Te queda alguna otra duda?",
    fase: "En intervención",
    horasAtras: 14,
  },
  {
    respuesta: "¿Y si no funciona? ¿Hay garantía? Porque es mucho dinero y quiero estar seguro",
    intencion: "Tiene duda sobre tratamiento",
    urgencia: "ALTO",
    accion: "Informar sobre garantías",
    mensaje: "Hola {nombre}, tu {tratamiento} tiene una garantía de 5 años. Además, hacemos revisiones periódicas incluidas. Es una inversión con respaldo total por nuestra parte.",
    fase: "Esperando respuesta",
    horasAtras: 48,
  },

  // ── ALTO: Pide oferta/descuento (4) ──
  {
    respuesta: "Me parece caro. En otra clínica me han dado un presupuesto 400€ más barato por lo mismo",
    intencion: "Pide oferta/descuento",
    urgencia: "ALTO",
    accion: "Preparar contraoferta",
    mensaje: "{nombre}, entendemos que compares opciones. Nuestro precio para tu {tratamiento} incluye materiales premium y revisiones. ¿Podemos revisar el presupuesto contigo para ajustarnos?",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 20,
  },
  {
    respuesta: "hola buenas, haceis algun tipo de descuento si pago al contado?",
    intencion: "Pide oferta/descuento",
    urgencia: "ALTO",
    accion: "Ofrecer descuento contado",
    mensaje: "Hola {nombre}, sí, para pago al contado de tu {tratamiento} podemos aplicar un 5% de descuento directo. ¿Te interesa que te pase el presupuesto actualizado?",
    fase: "En intervención",
    horasAtras: 7,
  },
  {
    respuesta: "Es que son 4.000€ y ahora mismo no puedo. ¿No hay forma de bajar un poco? Aunque sea solo los honorarios",
    intencion: "Pide oferta/descuento",
    urgencia: "ALTO",
    accion: "Consultar descuento con doctor",
    mensaje: "{nombre}, vamos a revisar tu {tratamiento} con el doctor para ver si podemos ajustar el presupuesto. Te llamamos hoy con una propuesta. ¿Te va bien?",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 16,
  },
  {
    respuesta: "si teneis alguna oferta de primavera o algo me animo, pero al precio normal se me va del presupuesto",
    intencion: "Pide oferta/descuento",
    urgencia: "ALTO",
    accion: "Informar promociones vigentes",
    mensaje: "Hola {nombre}, tenemos una promoción este mes en {tratamiento} con facilidades de pago especiales. Te envío los detalles para que puedas valorarlo.",
    fase: "En intervención",
    horasAtras: 30,
  },

  // ── MEDIO: Quiere pensarlo (4) ──
  {
    respuesta: "Deja que lo hable con mi mujer y te digo algo el lunes",
    intencion: "Quiere pensarlo",
    urgencia: "MEDIO",
    accion: "Seguimiento el lunes",
    mensaje: "{nombre}, por supuesto, tómate el tiempo que necesites. Si tu pareja tiene alguna pregunta sobre el {tratamiento}, estaremos encantados de resolverla. ¡Buen fin de semana!",
    fase: "Recordatorio 3d",
    tipoAccion: "Mensaje recibido",
    horasAtras: 72,
  },
  {
    respuesta: "gracias, lo voy a pensar. ahora mismo no tengo claro si hacerlo o esperar al verano",
    intencion: "Quiere pensarlo",
    urgencia: "MEDIO",
    accion: "Recordatorio en 5 días",
    mensaje: "Hola {nombre}, entendemos. Ten en cuenta que empezar tu {tratamiento} ahora te permitiría terminarlo justo para el verano. Quedo a tu disposición cuando lo tengas más claro.",
    fase: "Recordatorio 3d",
    horasAtras: 96,
  },
  {
    respuesta: "ok gracias",
    intencion: "Sin clasificar",
    urgencia: "MEDIO",
    accion: "Hacer seguimiento telefónico",
    mensaje: "{nombre}, ¿has tenido tiempo de pensar sobre tu {tratamiento}? Estamos aquí para resolver cualquier duda que te haya surgido.",
    fase: "Recordatorio 7d",
    tipoAccion: "WhatsApp enviado",
    horasAtras: 120,
  },
  {
    respuesta: "bueno, ya te digo. es que tengo muchos gastos este mes",
    intencion: "Quiere pensarlo",
    urgencia: "MEDIO",
    accion: "Proponer financiación",
    mensaje: "Hola {nombre}, lo entendemos perfectamente. ¿Sabías que para tu {tratamiento} hay financiación sin intereses desde 50€/mes? Así no notarías el gasto. ¿Te cuento?",
    fase: "Esperando respuesta",
    tipoAccion: "Mensaje recibido",
    horasAtras: 48,
  },

  // ── BAJO: Rechaza (3) ──
  {
    respuesta: "No gracias, al final me lo voy a hacer en otra clínica que me queda más cerca de casa",
    intencion: "Rechaza",
    urgencia: "BAJO",
    accion: "Registrar pérdida — otra clínica",
    mensaje: "{nombre}, respetamos tu decisión. Si en el futuro necesitas cualquier cosa relacionada con tu salud dental, aquí nos tienes. Un saludo.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 48,
  },
  {
    respuesta: "Lo siento pero he decidido no hacerme el tratamiento de momento. Quizá más adelante",
    intencion: "Rechaza",
    urgencia: "BAJO",
    accion: "Programar reactivación 90d",
    mensaje: "{nombre}, sin problema. Dejamos tu presupuesto guardado por si más adelante decides retomarlo. No dudes en contactarnos cuando quieras.",
    fase: "En intervención",
    horasAtras: 72,
  },
  {
    respuesta: "es q no me convence, prefiero esperar a ver si se me pasa solo el dolor antes de gastarme ese dinero",
    intencion: "Rechaza",
    urgencia: "BAJO",
    accion: "Alertar riesgo salud al doctor",
    mensaje: "Hola {nombre}, entendemos tu postura. Solo queremos recordarte que postergar tu {tratamiento} podría complicar la situación. Quedamos a tu disposición para una segunda opinión sin compromiso.",
    fase: "En intervención",
    tipoAccion: "Mensaje recibido",
    horasAtras: 36,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function horasAIso(horas: number): string {
  const d = new Date(Date.now() - horas * 60 * 60 * 1000);
  return d.toISOString();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchAllRecords(table: string, formula: string, fields: string[]): Promise<any[]> {
  const records: any[] = [];
  return new Promise((resolve, reject) => {
    base(table)
      .select({ filterByFormula: formula, fields, pageSize: 100 })
      .eachPage(
        (pageRecords: any[], next: () => void) => {
          records.push(...pageRecords);
          next();
        },
        (err: Error | null) => (err ? reject(err) : resolve(records))
      );
  });
}

async function batchUpdate(table: string, updates: { id: string; fields: Record<string, any> }[]) {
  // Airtable API allows max 10 per request
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    await base(table).update(batch.map((u) => ({ id: u.id, fields: u.fields })) as any);
    console.log(`  ✓ Batch ${Math.floor(i / 10) + 1}/${Math.ceil(updates.length / 10)} — ${batch.length} registros`);
    // Small delay to respect rate limits
    if (i + 10 < updates.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🎯 Seed de Intervención — Cola de Intervención");
  console.log("================================================\n");

  // 1. Fetch presupuestos activos
  console.log("1. Cargando presupuestos activos...");
  const formula = "AND({Estado}!='ACEPTADO',{Estado}!='PERDIDO')";
  const fields = [
    "Paciente_nombre", "Tratamiento_nombre", "Importe", "Estado", "Clinica",
    "Ultima_respuesta_paciente", // para no sobreescribir si ya tiene
  ];

  const records = await fetchAllRecords("Presupuestos", formula, fields);
  console.log(`   ${records.length} presupuestos activos encontrados\n`);

  // Filter out records that already have intervention data
  const sinIntervencion = records.filter((r) => {
    const f = r.fields as any;
    return !f["Ultima_respuesta_paciente"];
  });
  console.log(`   ${sinIntervencion.length} sin datos de intervención\n`);

  // 2. Select ~80 records distributed across clinics
  const shuffled = shuffle(sinIntervencion);
  const toSeed = shuffled.slice(0, Math.min(80, shuffled.length));
  console.log(`2. Seleccionados ${toSeed.length} registros para seed\n`);

  // 3. Assign scenarios
  console.log("3. Asignando escenarios realistas...\n");
  const updates: { id: string; fields: Record<string, any> }[] = [];

  for (let i = 0; i < toSeed.length; i++) {
    const rec = toSeed[i];
    const f = rec.fields as any;
    const escenario = ESCENARIOS[i % ESCENARIOS.length];

    // Extract patient name and treatment for personalizing messages
    const rawName = f["Paciente_nombre"];
    const patientName = Array.isArray(rawName) ? String(rawName[0] ?? "Paciente") : String(rawName ?? "Paciente");
    const firstName = patientName.split(" ")[0];
    const tratamiento = String(f["Tratamiento_nombre"] ?? "tratamiento").split(/[,+]/)[0].trim().toLowerCase();

    // Personalize message
    const mensajePersonalizado = escenario.mensaje
      .replace(/\{nombre\}/g, firstName)
      .replace(/\{tratamiento\}/g, tratamiento);

    // Vary the hours a bit for each record
    const horasVariadas = escenario.horasAtras + Math.floor(Math.random() * 12) - 6;
    const horasPositivas = Math.max(1, horasVariadas);

    const updateFields: Record<string, any> = {
      Ultima_respuesta_paciente: escenario.respuesta,
      Fecha_ultima_respuesta: horasAIso(horasPositivas),
      Intencion_detectada: escenario.intencion,
      Urgencia_intervencion: escenario.urgencia,
      Accion_sugerida: escenario.accion,
      Mensaje_sugerido: mensajePersonalizado,
      Fase_seguimiento: escenario.fase,
    };

    // Add action timestamps for ~60% of records
    if (escenario.tipoAccion) {
      updateFields["Ultima_accion_registrada"] = horasAIso(Math.max(1, horasPositivas - 2));
      updateFields["Tipo_ultima_accion"] = escenario.tipoAccion;
    }

    updates.push({ id: rec.id, fields: updateFields });
  }

  // Count distribution
  const dist: Record<string, number> = {};
  for (const u of updates) {
    const urg = u.fields["Urgencia_intervencion"] as string;
    dist[urg] = (dist[urg] ?? 0) + 1;
  }
  console.log("   Distribución por urgencia:");
  for (const [urg, count] of Object.entries(dist).sort((a, b) => {
    const order = ["CRÍTICO", "ALTO", "MEDIO", "BAJO"];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  })) {
    console.log(`     ${urg}: ${count}`);
  }
  console.log();

  // Count by clinic
  const clinicDist: Record<string, number> = {};
  for (let i = 0; i < toSeed.length; i++) {
    const f = toSeed[i].fields as any;
    const clinica = String(f["Clinica"] ?? "Sin clínica");
    clinicDist[clinica] = (clinicDist[clinica] ?? 0) + 1;
  }
  console.log("   Distribución por clínica:");
  for (const [cli, count] of Object.entries(clinicDist).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cli}: ${count}`);
  }
  console.log();

  // 4. Batch update
  console.log(`4. Escribiendo ${updates.length} registros en Airtable...\n`);
  await batchUpdate("Presupuestos", updates);

  console.log(`\n✅ Seed completado: ${updates.length} presupuestos con datos de intervención`);
  console.log("   Abre la tab 'Intervención' en /presupuestos para verificar");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
