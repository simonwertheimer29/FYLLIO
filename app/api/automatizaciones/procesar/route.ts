// app/api/automatizaciones/procesar/route.ts
// POST — Evalúa presupuestos y genera secuencias automáticas de mensajes.
// Llama al LLM (Claude Haiku) para generar el mensaje de cada evento.
// Solo crea 1 secuencia por presupuesto (prioridad EVENTO1 > 2 > 3 > 4).

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { kv } from "@vercel/kv";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession, TipoEvento, ConfiguracionAutomatizacion } from "../../../lib/presupuestos/types";
import { sendPushToClinica, sendPushToAll } from "../../../lib/push/sender";
import { DateTime } from "luxon";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

const DEFAULTS: Omit<ConfiguracionAutomatizacion, "clinica"> = {
  activa: true,
  diasInactividadAlerta: 3,
  diasPortalSinRespuesta: 2,
  diasReactivacion: 90,
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

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

async function getBestTono(clinica: string): Promise<string> {
  try {
    const res = await fetch(
      `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/presupuestos/tonos-stats?clinica=${encodeURIComponent(clinica)}`,
      { headers: { Cookie: (await cookies()).toString() } }
    );
    if (!res.ok) return "empatico";
    const d = await res.json();
    const stats: Record<string, { contactados: number; aceptados: number; tasa: number | null }> = d.stats ?? {};
    let bestTono = "empatico";
    let bestTasa = -1;
    for (const [tono, stat] of Object.entries(stats)) {
      if (stat.tasa != null && stat.contactados >= 10 && stat.tasa > bestTasa) {
        bestTasa = stat.tasa;
        bestTono = tono;
      }
    }
    return bestTono;
  } catch {
    return "empatico";
  }
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
        max_tokens: 200,
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

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Resumen diario — comprobar ventana 09:00–09:15 Madrid antes del procesamiento
  const ahoraMadrid = DateTime.now().setZone(ZONE);
  const esVentanaResumen = ahoraMadrid.hour === 9 && ahoraMadrid.minute < 15;
  const hoyKey = `fyllio_resumen_push:${ahoraMadrid.toISODate()}`;
  let yaEnviadoHoy = false;
  if (esVentanaResumen) {
    try {
      yaEnviadoHoy = !!(await kv.get(hoyKey));
    } catch { /* kv optional */ }
  }

  // Demo mode — sin Airtable
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ procesados: 0, nuevas: 0, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    // ── 1. Cargar configuraciones por clínica ─────────────────────────────────
    const configRecs = await base(TABLES.configuracionAutomatizaciones as any)
      .select({ fields: ["clinica", "activa", "dias_inactividad_alerta", "dias_portal_sin_respuesta", "dias_reactivacion"] })
      .all();

    const configMap = new Map<string, Omit<ConfiguracionAutomatizacion, "clinica">>();
    for (const rec of configRecs) {
      const f = rec.fields as any;
      const clinica = String(f["clinica"] ?? "");
      if (!clinica) continue;
      configMap.set(clinica, {
        activa: f["activa"] === true,
        diasInactividadAlerta: Number(f["dias_inactividad_alerta"] ?? DEFAULTS.diasInactividadAlerta),
        diasPortalSinRespuesta: Number(f["dias_portal_sin_respuesta"] ?? DEFAULTS.diasPortalSinRespuesta),
        diasReactivacion: Number(f["dias_reactivacion"] ?? DEFAULTS.diasReactivacion),
      });
    }

    // ── 2. Cargar presupuestos ────────────────────────────────────────────────
    const presRecs = await base(TABLES.presupuestos as any)
      .select({
        fields: [
          "Paciente_nombre", "Paciente_Telefono", "Teléfono",
          "Tratamiento_nombre", "Estado", "Fecha", "Clinica",
          "ContactCount", "PortalEnviado", "Reactivacion",
        ],
        maxRecords: 1000,
      })
      .all();

    // ── 3. Cargar secuencias pendientes para deduplicar ───────────────────────
    const pendientesRecs = await base(TABLES.secuenciasAutomaticas as any)
      .select({
        filterByFormula: `{estado}="pendiente"`,
        fields: ["presupuesto_id"],
        maxRecords: 5000,
      })
      .all();
    const pendientesIds = new Set(pendientesRecs.map((r) => String((r.fields as any)["presupuesto_id"] ?? "")));

    // ── 4. Evaluar eventos ────────────────────────────────────────────────────
    let procesados = 0;
    let nuevas = 0;

    for (const rec of presRecs) {
      procesados++;
      const f = rec.fields as any;

      if (pendientesIds.has(rec.id)) continue;

      const estado = String(f["Estado"] ?? "PRESENTADO");
      const clinica = String(f["Clinica"] ?? "");
      const config = configMap.get(clinica) ?? DEFAULTS;
      if (!config.activa) continue;

      const fechaRaw = String(f["Fecha"] ?? "").slice(0, 10) ||
        DateTime.now().setZone(ZONE).toISODate()!;
      const ds = daysSince(fechaRaw);

      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "el paciente")
        : "el paciente";
      const firstName = patientName.split(" ")[0];

      const phone =
        f["Paciente_Telefono"]
          ? String(f["Paciente_Telefono"])
          : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
            ? String(f["Teléfono"][0])
            : "";

      const tratamientoRaw = String(f["Tratamiento_nombre"] ?? "el tratamiento");
      const tratamiento = tratamientoRaw.split(/[,+]/)[0].trim() || "el tratamiento";

      const activos = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"];
      const urgencyScore = (() => {
        if (!activos.includes(estado)) return 0;
        if (ds >= 30) return 85;
        if (ds >= 14) return 75;
        if (ds >= 7) return 55;
        return 25;
      })();

      const portalEnviado = f["PortalEnviado"] === true;
      const reactivacion = f["Reactivacion"] === true;

      let tipoEvento: TipoEvento | null = null;
      let prompt = "";
      let canal: "whatsapp" | "email" | "interno" = "whatsapp";

      // EVENTO 1 — presupuesto inactivo
      if (
        activos.includes(estado) &&
        urgencyScore >= 50 &&
        ds >= config.diasInactividadAlerta
      ) {
        tipoEvento = "presupuesto_inactivo";
        const tono = await getBestTono(clinica);
        prompt = `Eres un asistente de seguimiento de clínica dental. Redacta un mensaje de WhatsApp breve y natural en tono ${tono} para hacer seguimiento a ${firstName}, que recibió presupuesto de ${tratamiento} hace ${ds} días y no ha respondido. Máximo 2 frases. Sin emojis excesivos.`;
      }

      // EVENTO 2 — portal visto sin respuesta
      else if (
        portalEnviado &&
        ["PRESENTADO", "INTERESADO", "EN_DUDA"].includes(estado) &&
        ds >= config.diasPortalSinRespuesta
      ) {
        tipoEvento = "portal_visto_sin_respuesta";
        const tono = await getBestTono(clinica);
        prompt = `Redacta un mensaje de WhatsApp breve y natural en tono ${tono} para ${firstName}. El paciente recibió el presupuesto de ${tratamiento} por portal y aún no ha respondido. Invítalo a resolver dudas. Máximo 2 frases.`;
      }

      // EVENTO 3 — reactivación programada
      else if (
        estado === "PERDIDO" &&
        reactivacion &&
        ds >= config.diasReactivacion
      ) {
        tipoEvento = "reactivacion_programada";
        const tono = await getBestTono(clinica);
        prompt = `Redacta un mensaje de WhatsApp de reactivación en tono ${tono} para ${firstName}, que mostró interés en ${tratamiento} hace ${ds} días. Mensaje cálido, corto, sin presión. Máximo 2 frases.`;
      }

      // EVENTO 4 — presupuesto aceptado (últimas 24h)
      else if (estado === "ACEPTADO" && ds <= 1) {
        tipoEvento = "presupuesto_aceptado_notificacion";
        canal = "interno";
      }

      if (!tipoEvento) continue;

      const mensaje = canal !== "interno" ? await generarMensajeIA(prompt) : "";
      const tono = canal !== "interno" ? await getBestTono(clinica) : "";

      await base(TABLES.secuenciasAutomaticas as any).create([{
        fields: {
          presupuesto_id:  rec.id,
          clinica,
          paciente_nombre: patientName,
          telefono:        phone,
          tratamiento,
          tipo_evento:     tipoEvento,
          estado:          "pendiente",
          mensaje_generado: mensaje,
          tono_usado:      tono,
          canal_sugerido:  canal,
          creado_en:       now,
          actualizado_en:  now,
        },
      }]);

      pendientesIds.add(rec.id);
      nuevas++;

      // Evento C: push cuando se prepara un mensaje automático
      sendPushToClinica(clinica, {
        title: "✦ Mensaje preparado",
        body: `Mensaje preparado para ${patientName} (${tratamiento}) — revísalo en Automatizaciones`,
        url: "/presupuestos",
        tag: `auto-${rec.id}`,
      }).catch(() => {});
    }

    // Evento D: resumen diario de riesgo (09:00–09:15 Madrid, una vez al día)
    if (esVentanaResumen && !yaEnviadoHoy) {
      const ACTIVOS = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"];
      const riesgoAlto = presRecs.filter((r) => {
        const f = r.fields as any;
        const estado = String(f["Estado"] ?? "");
        if (!ACTIVOS.includes(estado)) return false;
        const fecha = String(f["Fecha"] ?? "").slice(0, 10);
        const ds = fecha ? daysSince(fecha) : 0;
        return ds >= 14; // urgencyScore >= 75
      });
      const enJuego = riesgoAlto.reduce((s, r) => {
        const f = r.fields as any;
        return s + (f["Importe"] ? Number(f["Importe"]) : 0);
      }, 0);

      if (riesgoAlto.length > 0) {
        sendPushToAll({
          title: "⚠️ Resumen de riesgo",
          body: `${riesgoAlto.length} presupuestos de riesgo alto sin contactar — €${enJuego.toLocaleString("es-ES")} en juego`,
          url: "/presupuestos",
          tag: "resumen-diario",
        }).catch(() => {});
      }

      try {
        await kv.set(hoyKey, 1, { ex: 86400 });
      } catch { /* kv optional */ }
    }

    return NextResponse.json({ procesados, nuevas });
  } catch (err) {
    console.error("[automatizaciones/procesar POST]", err);
    return NextResponse.json({ error: "Error al procesar automatizaciones" }, { status: 500 });
  }
}
