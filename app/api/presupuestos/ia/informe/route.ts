// app/api/presupuestos/ia/informe/route.ts
// Generates a monthly narrative report using Claude Sonnet.
// POST { mes: "YYYY-MM", clinicaId: "todas" | string }

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { base, TABLES } from "../../../../lib/airtable";
import { DateTime } from "luxon";
import { computeUrgencyScore } from "../../../../lib/presupuestos/urgency";
import { ESTADOS_ACEPTADOS } from "../../../../lib/presupuestos/colors";
import type { Presupuesto, UserSession } from "../../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch { return null; }
}

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

const ORIGEN_DISPLAY: Record<string, string> = {
  google_ads: "Google Ads", seo_organico: "SEO", referido_paciente: "Referido",
  redes_sociales: "RRSS", walk_in: "Walk-in", otro: "Otro",
};
const MOTIVO_DISPLAY: Record<string, string> = {
  precio_alto: "Precio alto", otra_clinica: "Otra clínica", sin_urgencia: "Sin urgencia",
  necesita_financiacion: "Financiación", miedo_tratamiento: "Miedo al tratamiento",
  no_responde: "No responde", otro: "Otro",
};

async function fetchPresupuestosMes(
  clinica: string | null,
  mes: string
): Promise<{ filtered: Presupuesto[] | null; all: Presupuesto[] }> {
  try {
    // Fetch all records (optionally filtered by clinica) — date filtering done in JS
    // This matches the approach used by /api/presupuestos/kpis for reliability
    const selectOpts: Record<string, unknown> = {
      fields: [
        "Paciente_nombre", "Tratamiento_nombre", "Doctor", "Doctor_Especialidad",
        "TipoPaciente", "TipoVisita", "Importe", "Estado", "Fecha", "FechaAlta",
        "Clinica", "ContactCount", "OrigenLead", "MotivoPerdida", "MotivoDuda",
      ],
      sort: [{ field: "Fecha", direction: "desc" }],
      maxRecords: 2000,
    };

    const recs = await base(TABLES.presupuestos as any).select(selectOpts).all();
    if (recs.length === 0) return { filtered: null, all: [] };

    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const all = recs.map((r) => {
      const f = r.fields as any;
      const fechaPresupuesto = String(f["Fecha"] ?? "").slice(0, 10) || today;
      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : "Paciente";
      const p: Presupuesto = {
        id: r.id,
        patientName,
        treatments: f["Tratamiento_nombre"] ? String(f["Tratamiento_nombre"]).split(/[,+]/).map((t: string) => t.trim()).filter(Boolean) : [],
        doctor: f["Doctor"] ? String(f["Doctor"]) : undefined,
        doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
        tipoPaciente: f["TipoPaciente"] ?? undefined,
        tipoVisita: f["TipoVisita"] ?? undefined,
        amount: f["Importe"] ? Number(f["Importe"]) : undefined,
        estado: f["Estado"] ?? "INTERESADO",
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: daysSince(fechaPresupuesto),
        clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
        urgencyScore: 0,
        contactCount: Number(f["ContactCount"] ?? 0),
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
        motivoDuda: f["MotivoDuda"] ?? undefined,
      };
      p.urgencyScore = computeUrgencyScore(p);
      return p;
    });

    // Filter by month and clinica in JS (more reliable than Airtable date formulas)
    let filtered = all.filter((p) => p.fechaPresupuesto.startsWith(mes));
    if (clinica) filtered = filtered.filter((p) => p.clinica === clinica);

    return { filtered: filtered.length > 0 ? filtered : null, all };
  } catch {
    return { filtered: null, all: [] };
  }
}

const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function buildDatosResumen(
  presupuestos: Presupuesto[],
  allPresupuestos: Presupuesto[] = [],
  mes = ""
) {
  const total = presupuestos.length;
  const aceptados = presupuestos.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado));
  const perdidos = presupuestos.filter((p) => p.estado === "PERDIDO");
  const activos = presupuestos.filter((p) => !ESTADOS_ACEPTADOS.includes(p.estado) && p.estado !== "PERDIDO");
  const tasa = total > 0 ? Math.round((aceptados.length / total) * 100) : 0;
  const importeTotal = aceptados.reduce((s, p) => s + (p.amount ?? 0), 0);
  const importePipeline = activos.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Por doctor
  const docMap = new Map<string, { total: number; aceptados: number }>();
  presupuestos.forEach((p) => {
    const k = p.doctor ?? "Sin doctor";
    const v = docMap.get(k) ?? { total: 0, aceptados: 0 };
    docMap.set(k, { total: v.total + 1, aceptados: v.aceptados + (ESTADOS_ACEPTADOS.includes(p.estado) ? 1 : 0) });
  });
  const porDoctor = [...docMap.entries()]
    .map(([doctor, v]) => ({ doctor, ...v, tasa: v.total > 0 ? Math.round((v.aceptados / v.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  // Por origen
  const origenMap = new Map<string, number>();
  presupuestos.forEach((p) => origenMap.set(p.origenLead ?? "otro", (origenMap.get(p.origenLead ?? "otro") ?? 0) + 1));
  const porOrigen = [...origenMap.entries()]
    .map(([k, c]) => ({ origen: ORIGEN_DISPLAY[k] ?? k, count: c }))
    .sort((a, b) => b.count - a.count);

  // Motivos pérdida
  const motivoMap = new Map<string, number>();
  perdidos.forEach((p) => motivoMap.set(p.motivoPerdida ?? "otro", (motivoMap.get(p.motivoPerdida ?? "otro") ?? 0) + 1));
  const porMotivo = [...motivoMap.entries()]
    .map(([k, c]) => ({ motivo: MOTIVO_DISPLAY[k] ?? k, count: c }))
    .sort((a, b) => b.count - a.count);

  // Tipo paciente
  const privados = presupuestos.filter((p) => p.tipoPaciente === "Privado");
  const adeslas = presupuestos.filter((p) => p.tipoPaciente === "Adeslas");
  const tasaPrivados = privados.length > 0 ? Math.round((privados.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado)).length / privados.length) * 100) : 0;
  const tasaAdeslas = adeslas.length > 0 ? Math.round((adeslas.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado)).length / adeslas.length) * 100) : 0;

  // Tendencia mensual — últimos 12 meses (desde allPresupuestos sin filtro de clínica)
  const tendenciaMensual: { mes: string; label: string; total: number; aceptados: number }[] = [];
  if (mes) {
    const [mesY, mesM] = mes.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      let y = mesY;
      let m = mesM - i;
      while (m <= 0) { m += 12; y--; }
      const mesStr = `${y}-${String(m).padStart(2, "0")}`;
      const delMes = allPresupuestos.filter((p) => p.fechaPresupuesto.startsWith(mesStr));
      const acept = delMes.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado));
      tendenciaMensual.push({ mes: mesStr, label: MES_SHORT[m - 1], total: delMes.length, aceptados: acept.length });
    }
  }

  // Por clínica (desde allPresupuestos sin filtro de mes)
  const clinicaMap = new Map<string, { total: number; aceptados: number; importeTotal: number }>();
  allPresupuestos.forEach((p) => {
    const k = p.clinica ?? "Sin clínica";
    const v = clinicaMap.get(k) ?? { total: 0, aceptados: 0, importeTotal: 0 };
    const esAcep = ESTADOS_ACEPTADOS.includes(p.estado);
    clinicaMap.set(k, {
      total: v.total + 1,
      aceptados: v.aceptados + (esAcep ? 1 : 0),
      importeTotal: v.importeTotal + (esAcep ? (p.amount ?? 0) : 0),
    });
  });
  const porClinica = [...clinicaMap.entries()]
    .map(([clinica, v]) => ({ clinica, ...v, tasa: v.total > 0 ? Math.round((v.aceptados / v.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  return {
    total, aceptados: aceptados.length, perdidos: perdidos.length, activos: activos.length,
    tasa, importeTotal, importePipeline,
    porDoctor, porOrigen, porMotivo,
    privados: { total: privados.length, tasa: tasaPrivados },
    adeslas: { total: adeslas.length, tasa: tasaAdeslas },
    tendenciaMensual,
    porClinica,
  };
}

function buildPrompt(mes: string, clinicaNombre: string, datos: ReturnType<typeof buildDatosResumen>): string {
  const [y, m] = mes.split("-").map(Number);
  const mesLabel = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][m - 1];
  const periodoLabel = `${mesLabel} de ${y}`;

  const doctoresStr = datos.porDoctor.slice(0, 5)
    .map((d) => `  - ${d.doctor}: ${d.total} presupuestos, ${d.aceptados} aceptados (${d.tasa}%)`)
    .join("\n");
  const origenStr = datos.porOrigen.slice(0, 4)
    .map((o) => `  - ${o.origen}: ${o.count}`)
    .join("\n");
  const motivosStr = datos.porMotivo.length > 0
    ? datos.porMotivo.slice(0, 3).map((m) => `  - ${m.motivo}: ${m.count}`).join("\n")
    : "  - Sin datos suficientes";

  return `Eres analista de negocio de una red de clínicas dentales en España.

DATOS DE ${periodoLabel.toUpperCase()} — ${clinicaNombre.toUpperCase()}:
- Total presupuestos: ${datos.total} | Aceptados: ${datos.aceptados} (${datos.tasa}%) | Perdidos: ${datos.perdidos}
- Importe aceptado: €${datos.importeTotal.toLocaleString("es-ES")} | Pipeline activo: €${datos.importePipeline.toLocaleString("es-ES")}
- Privado: ${datos.privados.total} presupuestos, tasa ${datos.privados.tasa}% | Adeslas: ${datos.adeslas.total} presupuestos, tasa ${datos.adeslas.tasa}%

Doctores (top 5):
${doctoresStr || "  - Sin datos"}

Captación por canal:
${origenStr || "  - Sin datos"}

Motivos de pérdida:
${motivosStr}

Genera un informe ejecutivo con EXACTAMENTE esta estructura (5 párrafos, sin títulos):

PÁRRAFO 1 — RESUMEN GLOBAL: tasa del mes, importe aceptado, comparativa si hay datos del mes anterior.
PÁRRAFO 2 — ANÁLISIS: doctor con mejor tasa y el que más necesita mejora (con números). Diferencia privado/Adeslas si es relevante.
PÁRRAFO 3 — BARRERAS: motivo de pérdida más frecuente, qué porcentaje representa, hipótesis sobre por qué ocurre.
PÁRRAFO 4 — CAPTACIÓN: canal con mejor volumen y cualquier patrón relevante en el origen de leads.
PÁRRAFO 5 — PLAN DE ACCIÓN: exactamente 3 recomendaciones concretas numeradas en una sola oración cada una.

REGLAS DE FORMATO:
- Usa **negritas** solo para nombres, clínicas, doctores y números clave.
- NO uses headers (#), listas (-), ni código.
- Tono directo. Si algo falló, dilo. Si algo funcionó bien, reconócelo.
- Máximo 400 palabras en total.
- NO inventes datos que no estén en los datos proporcionados.`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Managers only
  if (session.rol === "encargada_ventas") {
    return NextResponse.json({ error: "Acceso restringido a managers" }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const mes: string = body.mes ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const clinicaId: string = body.clinicaId ?? "todas";
  const clinicaFiltro = clinicaId === "todas" ? null : clinicaId;

  // Fetch data
  const { filtered: presupuestos, all } = await fetchPresupuestosMes(clinicaFiltro, mes);
  if (!presupuestos || presupuestos.length === 0) {
    return NextResponse.json({ error: "No hay datos para el mes y clínica seleccionados." }, { status: 404 });
  }

  const datos = buildDatosResumen(presupuestos, all, mes);
  const clinicaNombre = clinicaId === "todas" ? "Todas las clínicas" : clinicaId;
  const prompt = buildPrompt(mes, clinicaNombre, datos);

  try {
    const msg = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });

    const informe = (msg.content[0] as { type: string; text: string }).text ?? "";

    return NextResponse.json({
      informe,
      generadoEn: new Date().toISOString(),
      datosUsados: datos,
      mes,
      clinica: clinicaNombre,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: `Error al generar informe: ${msg}` }, { status: 500 });
  }
}
