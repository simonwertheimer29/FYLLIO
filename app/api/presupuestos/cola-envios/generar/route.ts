// app/api/presupuestos/cola-envios/generar/route.ts
// POST — genera la cola de envíos del día basada en plantillas + configuración

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import { DateTime } from "luxon";
import type {
  UserSession,
  PlantillaMensaje,
  ConfigRecordatorios,
  TipoPlantilla,
  TipoEnvio,
} from "../../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

const CONFIG_DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sustituirVariables(
  contenido: string,
  datos: { nombre: string; tratamiento: string; importe?: number; doctor?: string; clinica?: string },
): string {
  return contenido
    .replace(/\{nombre\}/g, datos.nombre)
    .replace(/\{tratamiento\}/g, datos.tratamiento)
    .replace(/\{importe\}/g, datos.importe != null ? `${datos.importe.toLocaleString("es-ES")}€` : "")
    .replace(/\{doctor\}/g, datos.doctor ?? "")
    .replace(/\{clinica\}/g, datos.clinica ?? "");
}

function seleccionarPlantilla(
  plantillas: PlantillaMensaje[],
  tipo: TipoPlantilla,
  doctor: string,
  tratamiento: string,
  clinica: string,
): PlantillaMensaje | null {
  const activas = plantillas.filter((p) => p.activa && p.tipo === tipo);
  if (activas.length === 0) return null;

  // Priority: doctor+treatment > doctor > treatment > clinic > general
  const scorePlantilla = (p: PlantillaMensaje): number => {
    let score = 0;
    const clinicaMatch = p.clinica === clinica || p.clinica === "Todas" || p.clinica === "";
    if (!clinicaMatch) return -1; // no match
    if (p.doctor && p.doctor === doctor) score += 2;
    if (p.tratamiento && p.tratamiento === tratamiento) score += 2;
    if (p.doctor && p.doctor !== doctor) return -1;
    if (p.tratamiento && p.tratamiento !== tratamiento) return -1;
    if (p.clinica === clinica) score += 1;
    return score;
  };

  let best: PlantillaMensaje | null = null;
  let bestScore = -1;
  for (const p of activas) {
    const s = scorePlantilla(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

async function generarMensajeIA(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.content?.[0]?.text ?? "").trim();
  } catch {
    return "";
  }
}

const IA_PROMPTS: Record<TipoPlantilla, (ctx: { nombre: string; tratamiento: string; doctor?: string }) => string> = {
  "Primer contacto": (ctx) =>
    `Redacta un mensaje de WhatsApp breve (2-3 frases) y profesional para hacer primer contacto con ${ctx.nombre}, paciente de clínica dental que recibió presupuesto de ${ctx.tratamiento}${ctx.doctor ? ` con ${ctx.doctor}` : ""}. Invita a resolver dudas. Sin emojis excesivos. En español.`,
  "Recordatorio": (ctx) =>
    `Redacta un mensaje de WhatsApp breve (2-3 frases), amable y sin presión, de recordatorio para ${ctx.nombre}, que recibió presupuesto de ${ctx.tratamiento} y no ha respondido. En español.`,
  "Detalles de pago": (ctx) =>
    `Redacta un mensaje de WhatsApp con opciones de pago para ${ctx.nombre}, que aceptó presupuesto de ${ctx.tratamiento}. Incluye: pago único con descuento, financiación 6 meses sin intereses, financiación 12 meses. Breve y profesional. En español.`,
  "Reactivacion": (ctx) =>
    `Redacta un mensaje de WhatsApp de reactivación breve y cálido para ${ctx.nombre}, que mostró interés en ${ctx.tratamiento} pero no aceptó. Sin presión. En español.`,
};

function daysSince(dateStr: string): number {
  const d = DateTime.fromISO(dateStr, { zone: ZONE });
  if (!d.isValid) return 0;
  return Math.floor(DateTime.now().setZone(ZONE).diff(d, "days").days);
}

// ─── POST — generar cola del día ──────────────────────────────────────────────

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const today = DateTime.now().setZone(ZONE);
  const todayStr = today.toISODate()!;

  try {
    // 1. Cargar configuraciones de recordatorios
    const configRecs = await base(TABLES.configuracionRecordatorios as any)
      .select({
        fields: ["Clinica", "Secuencia_dias", "Recordatorio_max", "Hora_envio", "Dias_rechazo_auto", "Activa"],
      })
      .all();

    const configMap = new Map<string, Omit<ConfigRecordatorios, "clinica">>();
    for (const rec of configRecs) {
      const f = rec.fields as any;
      const clinica = String(f["Clinica"] ?? "");
      if (!clinica) continue;
      const secStr = String(f["Secuencia_dias"] ?? "3,7,10");
      configMap.set(clinica, {
        secuenciaDias: secStr.split(",").map((s: string) => Number(s.trim())).filter((n: number) => !isNaN(n) && n > 0),
        recordatorioMax: Number(f["Recordatorio_max"] ?? 3),
        horaEnvio: String(f["Hora_envio"] ?? "09:00"),
        diasRechazoAuto: Number(f["Dias_rechazo_auto"] ?? 30),
        activa: f["Activa"] === true,
      });
    }

    // 2. Cargar plantillas activas
    const plantillaRecs = await base(TABLES.plantillasMensaje as any)
      .select({
        fields: ["Nombre", "Tipo", "Clinica", "Doctor", "Tratamiento", "Contenido", "Activa"],
        filterByFormula: `{Activa}=TRUE()`,
      })
      .all();

    const plantillas: PlantillaMensaje[] = plantillaRecs.map((r) => {
      const f = r.fields as any;
      return {
        id: r.id,
        nombre: String(f["Nombre"] ?? ""),
        tipo: f["Tipo"] ?? "Primer contacto",
        clinica: String(f["Clinica"] ?? "Todas"),
        doctor: String(f["Doctor"] ?? ""),
        tratamiento: String(f["Tratamiento"] ?? ""),
        contenido: String(f["Contenido"] ?? ""),
        activa: true,
        fechaCreacion: "",
      };
    });

    // 3. Fetch presupuestos activos + PERDIDO con Reactivacion
    const presRecs = await base(TABLES.presupuestos as any)
      .select({
        fields: [
          "Paciente_nombre", "Paciente_Telefono", "Teléfono",
          "Tratamiento_nombre", "Estado", "Fecha", "Clinica",
          "ContactCount", "Reactivacion", "Importe", "Doctor",
          "Intencion_detectada",
        ],
        maxRecords: 2000,
      })
      .all();

    // 4. Fetch envíos existentes de hoy para deduplicar
    const enviosHoyRecs = await base(TABLES.colaEnvios as any)
      .select({
        fields: ["Presupuesto", "Tipo"],
        filterByFormula: `IS_SAME({Programado_para},'${todayStr}','day')`,
        maxRecords: 5000,
      })
      .all();

    const enviosExistentes = new Set(
      enviosHoyRecs.map((r) => {
        const f = r.fields as any;
        return `${f["Presupuesto"] ?? ""}::${f["Tipo"] ?? ""}`;
      }),
    );

    // 5. Evaluar cada presupuesto
    let generados = 0;
    let omitidos = 0;
    let errores = 0;

    const ACTIVOS = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"];

    for (const rec of presRecs) {
      const f = rec.fields as any;
      const estado = String(f["Estado"] ?? "PRESENTADO");
      const clinica = Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? "");
      const config = configMap.get(clinica) ?? CONFIG_DEFAULTS;

      if (!config.activa) {
        omitidos++;
        continue;
      }

      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : String(f["Paciente_nombre"] ?? "Paciente");
      const phone = f["Paciente_Telefono"]
        ? String(f["Paciente_Telefono"])
        : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
          ? String(f["Teléfono"][0])
          : "";
      const tratamientoRaw = String(f["Tratamiento_nombre"] ?? "tratamiento");
      const tratamiento = tratamientoRaw.split(/[,+]/)[0].trim() || "tratamiento";
      const doctor = Array.isArray(f["Doctor"]) ? String(f["Doctor"][0] ?? "") : String(f["Doctor"] ?? "");
      const importe = f["Importe"] != null ? Number(f["Importe"]) : undefined;
      const contactCount = Number(f["ContactCount"] ?? 0);
      const reactivacion = f["Reactivacion"] === true;
      const intencion = String(f["Intencion_detectada"] ?? "");
      const fechaRaw = String(f["Fecha"] ?? "").slice(0, 10);
      const ds = fechaRaw ? daysSince(fechaRaw) : 0;

      if (!phone) {
        omitidos++;
        continue;
      }

      // Determine what type of send is needed
      let tipoEnvio: TipoEnvio | null = null;
      let tipoPlantilla: TipoPlantilla | null = null;

      if (ACTIVOS.includes(estado)) {
        // Check for payment details first
        if (intencion === "Acepta pero pregunta pago") {
          const dedupeKey = `${rec.id}::Detalles de pago`;
          if (!enviosExistentes.has(dedupeKey)) {
            tipoEnvio = "Detalles de pago";
            tipoPlantilla = "Detalles de pago";
          }
        }

        // Primer contacto or recordatorio
        if (!tipoEnvio) {
          if (contactCount === 0) {
            const dedupeKey = `${rec.id}::Primer contacto`;
            if (!enviosExistentes.has(dedupeKey)) {
              tipoEnvio = "Primer contacto";
              tipoPlantilla = "Primer contacto";
            }
          } else {
            // Check if a reminder is due based on sequence
            const { secuenciaDias, recordatorioMax } = config;
            for (let i = 0; i < Math.min(secuenciaDias.length, recordatorioMax); i++) {
              if (ds >= secuenciaDias[i]) {
                const reminderNum = i + 1;
                const reminderTipo: TipoEnvio = `Recordatorio ${reminderNum}` as TipoEnvio;
                const dedupeKey = `${rec.id}::${reminderTipo}`;
                if (!enviosExistentes.has(dedupeKey)) {
                  tipoEnvio = reminderTipo;
                  tipoPlantilla = "Recordatorio";
                  break;
                }
              }
            }
          }
        }

        // Auto-reject if beyond threshold
        if (!tipoEnvio && ds >= config.diasRechazoAuto) {
          omitidos++;
          continue;
        }
      } else if (estado === "PERDIDO" && reactivacion && ds >= 90) {
        const dedupeKey = `${rec.id}::Reactivacion`;
        if (!enviosExistentes.has(dedupeKey)) {
          tipoEnvio = "Reactivacion";
          tipoPlantilla = "Reactivacion";
        }
      }

      if (!tipoEnvio || !tipoPlantilla) {
        omitidos++;
        continue;
      }

      // 6. Select template or generate with AI
      const plantilla = seleccionarPlantilla(plantillas, tipoPlantilla, doctor, tratamiento, clinica);
      let contenido: string;
      let plantillaUsada: string;

      if (plantilla) {
        contenido = sustituirVariables(plantilla.contenido, {
          nombre: patientName,
          tratamiento,
          importe,
          doctor,
          clinica,
        });
        plantillaUsada = plantilla.nombre;
      } else {
        // Generate with AI
        const prompt = IA_PROMPTS[tipoPlantilla]({ nombre: patientName, tratamiento, doctor });
        contenido = await generarMensajeIA(prompt);
        plantillaUsada = "Generado por IA";
        if (!contenido) {
          errores++;
          continue;
        }
      }

      // 7. Create record in Cola_Envios
      const horaEnvio = config.horaEnvio || "09:00";
      const programadoPara = `${todayStr}T${horaEnvio}:00`;

      try {
        await (base(TABLES.colaEnvios as any).create as any)({
          Presupuesto: rec.id,
          Paciente: patientName,
          Telefono: phone,
          Contenido: contenido,
          Tipo: tipoEnvio,
          Estado: "Pendiente",
          Programado_para: programadoPara,
          Plantilla_usada: plantillaUsada,
        });

        enviosExistentes.add(`${rec.id}::${tipoEnvio}`);
        generados++;
      } catch (err) {
        console.error(`[cola-envios/generar] Error creating envío for ${rec.id}:`, err);
        errores++;
      }
    }

    return NextResponse.json({ generados, omitidos, errores });
  } catch (err) {
    console.error("[cola-envios/generar] Error:", err);
    return NextResponse.json({ error: "Error al generar cola" }, { status: 500 });
  }
}
