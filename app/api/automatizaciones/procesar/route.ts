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

async function generarInformeSemanalIA(prompt: string): Promise<string> {
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
        model: "claude-sonnet-4-6",
        max_tokens: 900,
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

  const esLunes = ahoraMadrid.weekday === 1;
  const semanaKey = `fyllio_informe_semanal:${ahoraMadrid.weekYear}-W${String(ahoraMadrid.weekNumber).padStart(2, "0")}`;
  let yaEnviadoSemana = false;
  if (esLunes && esVentanaResumen) {
    try {
      yaEnviadoSemana = !!(await kv.get(semanaKey));
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
          "ContactCount", "PortalEnviado", "Reactivacion", "Importe",
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

    // Evento E: informe semanal automático (lunes, 09:00-09:15 Madrid, una vez por semana)
    if (esLunes && esVentanaResumen && !yaEnviadoSemana) {
      try {
        const ACTIVOS_SET = new Set(["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"]);
        const mesActual = ahoraMadrid.toFormat("yyyy-MM");

        // ── Métricas por clínica ───────────────────────────────────────────────
        const clinicaMap = new Map<string, {
          nuevos: number;
          totalSeguimiento: number;
          eurosSeguimiento: number;
          riesgoAlto: number;
          riesgoMuyAlto: number;
          aceptadosEstaSemana: number;
          perdidosEstaSemana: number;
        }>();

        for (const rec of presRecs) {
          const f = rec.fields as any;
          const clinicaNombre = String(f["Clinica"] ?? "");
          if (!clinicaNombre) continue;

          const estado = String(f["Estado"] ?? "");
          const fecha = String(f["Fecha"] ?? "").slice(0, 10);
          const importe = f["Importe"] ? Number(f["Importe"]) : 0;
          const ds = fecha ? daysSince(fecha) : 999;

          if (!clinicaMap.has(clinicaNombre)) {
            clinicaMap.set(clinicaNombre, {
              nuevos: 0, totalSeguimiento: 0, eurosSeguimiento: 0,
              riesgoAlto: 0, riesgoMuyAlto: 0,
              aceptadosEstaSemana: 0, perdidosEstaSemana: 0,
            });
          }
          const s = clinicaMap.get(clinicaNombre)!;

          if (ds <= 7) s.nuevos++;
          if (estado === "ACEPTADO" && ds <= 7) s.aceptadosEstaSemana++;
          if (estado === "PERDIDO"  && ds <= 7) s.perdidosEstaSemana++;

          if (ACTIVOS_SET.has(estado)) {
            s.totalSeguimiento++;
            s.eurosSeguimiento += importe;
            if (ds >= 14) s.riesgoAlto++;
            if (ds >= 30) s.riesgoMuyAlto++;
          }
        }

        const clinicasData = Array.from(clinicaMap.entries()).map(([clinica, s]) => ({
          clinica,
          nuevos: s.nuevos,
          totalSeguimiento: s.totalSeguimiento,
          eurosSeguimiento: Math.round(s.eurosSeguimiento),
          riesgoAlto: s.riesgoAlto,
          riesgoMuyAlto: s.riesgoMuyAlto,
          aceptadosEstaSemana: s.aceptadosEstaSemana,
          perdidosEstaSemana: s.perdidosEstaSemana,
        }));

        const totalNuevos = clinicasData.reduce((s, c) => s + c.nuevos, 0);
        const totalSeguimiento = clinicasData.reduce((s, c) => s + c.totalSeguimiento, 0);
        const totalEurosSeguimiento = clinicasData.reduce((s, c) => s + c.eurosSeguimiento, 0);
        const totalRiesgoAlto = clinicasData.reduce((s, c) => s + c.riesgoAlto, 0);
        const totalRiesgoMuyAlto = clinicasData.reduce((s, c) => s + c.riesgoMuyAlto, 0);

        // ── Objetivos mensuales ────────────────────────────────────────────────
        const objetivosMap = new Map<string, number>();
        try {
          const objRecs = await base(TABLES.objetivosMensuales as any)
            .select({
              filterByFormula: `{mes}="${mesActual}"`,
              fields: ["clinica", "objetivo_aceptados"],
            })
            .all();
          for (const r of objRecs) {
            const f = r.fields as any;
            if (f["clinica"]) objetivosMap.set(String(f["clinica"]), Number(f["objetivo_aceptados"] ?? 0));
          }
        } catch { /* objetivos opcionales */ }

        // ── Aceptados este mes por clínica (proxy: Fecha del mes actual) ───────
        const aceptadosMesMap = new Map<string, number>();
        for (const rec of presRecs) {
          const f = rec.fields as any;
          if (f["Estado"] === "ACEPTADO" && String(f["Fecha"] ?? "").startsWith(mesActual)) {
            const c = String(f["Clinica"] ?? "");
            if (c) aceptadosMesMap.set(c, (aceptadosMesMap.get(c) ?? 0) + 1);
          }
        }

        // ── Prompt para Claude ─────────────────────────────────────────────────
        const clinicasStr = clinicasData.map((c) => {
          const obj = objetivosMap.get(c.clinica) ?? 0;
          const acept = aceptadosMesMap.get(c.clinica) ?? 0;
          const progreso = obj > 0
            ? `${acept}/${obj} aceptados este mes (${Math.round(acept / obj * 100)}%)`
            : `${acept} aceptados este mes`;
          return `  - ${c.clinica}: ${c.nuevos} nuevos, seguimiento ${c.totalSeguimiento} (€${c.eurosSeguimiento.toLocaleString("es-ES")}), riesgo alto ${c.riesgoAlto}, objetivo: ${progreso}`;
        }).join("\n");

        const promptSemanal = `Eres analista de negocio de una red de clínicas dentales en España.

DATOS SEMANA ${ahoraMadrid.weekNumber}/${ahoraMadrid.weekYear}:
- Nuevos presupuestos: ${totalNuevos} | En seguimiento: ${totalSeguimiento} | €${totalEurosSeguimiento.toLocaleString("es-ES")} en juego
- Riesgo alto (>14 días sin avance): ${totalRiesgoAlto} | Riesgo muy alto (>30 días): ${totalRiesgoMuyAlto}

Por clínica:
${clinicasStr}

Genera un informe semanal ejecutivo con EXACTAMENTE 2 secciones narrativas, seguidas del bloque estructurado obligatorio:

SECCIÓN 1 — QUÉ PASÓ ESTA SEMANA: 2 párrafos. Resumen de presupuestos nuevos, estado del pipeline y cualquier patrón relevante por clínica.

SECCIÓN 2 — QUÉ ESTÁ EN RIESGO: 1 párrafo. Presupuestos en riesgo alto y muy alto, clínicas más expuestas, progreso vs objetivo mensual. Identifica la situación más crítica en una frase final en negrita.

REGLAS DEL TEXTO NARRATIVO:
- **Negritas** solo para nombres de clínicas y números clave.
- Sin headers (#), listas (-) ni código.
- Tono directo y ejecutivo.
- 300-400 palabras en las 2 secciones.
- NO inventes datos que no estén en los datos proporcionados.

OBLIGATORIO — termina SIEMPRE con este bloque exacto, sin nada después:

ACCIONES_LUNES:
1. [primera acción concreta con nombre de clínica cuando aplique]
2. [segunda acción concreta con nombre de clínica cuando aplique]
3. [tercera acción concreta con nombre de clínica cuando aplique]
FIN_ACCIONES`;

        // ── Llamar a Claude (antes del upsert) ────────────────────────────────
        const textoNarrativo = await generarInformeSemanalIA(promptSemanal);

        // ── Construir payload final ────────────────────────────────────────────
        const alertaPrincipal =
          totalRiesgoAlto > 0
            ? `${totalRiesgoAlto} presupuestos de riesgo alto sin contactar — €${totalEurosSeguimiento.toLocaleString("es-ES")} en seguimiento`
            : `${totalSeguimiento} presupuestos activos — €${totalEurosSeguimiento.toLocaleString("es-ES")} en seguimiento`;

        const periodo = `${ahoraMadrid.weekYear}-W${String(ahoraMadrid.weekNumber).padStart(2, "0")}`;
        const titulo = `Informe semanal — Semana ${ahoraMadrid.weekNumber}, ${ahoraMadrid.weekYear}`;
        const contenidoJson = JSON.stringify({
          clinicas: clinicasData,
          totalNuevos,
          totalSeguimiento,
          eurosSeguimiento: totalEurosSeguimiento,
          riesgoAlto: totalRiesgoAlto,
          riesgoMuyAlto: totalRiesgoMuyAlto,
          semana: ahoraMadrid.weekNumber,
          anio: ahoraMadrid.weekYear,
          mesActual,
          objetivos: Object.fromEntries(objetivosMap),
          aceptadosMes: Object.fromEntries(aceptadosMesMap),
          alertaPrincipal,
        });

        // ── Save to Informes_Guardados (upsert, una sola escritura) ───────────
        try {
          const nowISO = new Date().toISOString();
          const existingRecs = await base(TABLES.informesGuardados as any)
            .select({
              filterByFormula: `AND({tipo}='semanal',{periodo}='${periodo}')`,
              maxRecords: 1,
              fields: ["tipo"],
            })
            .all();

          const upsertFields: Record<string, unknown> = {
            titulo,
            contenido_json: contenidoJson,
            generado_en: nowISO,
            generado_por: "sistema",
          };
          if (textoNarrativo) upsertFields["texto_narrativo"] = textoNarrativo;

          if (existingRecs.length > 0) {
            await base(TABLES.informesGuardados as any).update(existingRecs[0].id, upsertFields as any);
          } else {
            await (base(TABLES.informesGuardados as any) as any).create([{
              fields: { tipo: "semanal", clinica: "todas", periodo, ...upsertFields },
            }]);
          }
        } catch (saveErr) {
          console.error("[procesar] Error guardando informe semanal:", saveErr);
        }

        // ── Push notification ─────────────────────────────────────────────────
        sendPushToAll({
          title: "📋 Informe semanal listo",
          body: alertaPrincipal,
          url: "/presupuestos",
          tag: "informe-semanal",
        }).catch(() => {});

        try {
          await kv.set(semanaKey, 1, { ex: 7 * 86400 });
        } catch { /* kv optional */ }
      } catch (semanaErr) {
        console.error("[procesar] Error generando informe semanal:", semanaErr);
      }
    }

    return NextResponse.json({ procesados, nuevas });
  } catch (err) {
    console.error("[automatizaciones/procesar POST]", err);
    return NextResponse.json({ error: "Error al procesar automatizaciones" }, { status: 500 });
  }
}
