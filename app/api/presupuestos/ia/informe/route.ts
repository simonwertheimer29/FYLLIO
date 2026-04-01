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

async function fetchPresupuestosMes(clinica: string | null, mes: string): Promise<Presupuesto[] | null> {
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
    if (recs.length === 0) return null;

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

    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

function buildDatosResumen(presupuestos: Presupuesto[]) {
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

  return {
    total, aceptados: aceptados.length, perdidos: perdidos.length, activos: activos.length,
    tasa, importeTotal, importePipeline,
    porDoctor, porOrigen, porMotivo,
    privados: { total: privados.length, tasa: tasaPrivados },
    adeslas: { total: adeslas.length, tasa: tasaAdeslas },
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

  return `Eres el analista de negocio de una red de clínicas dentales. Genera un informe mensual ejecutivo en español.

DATOS DE ${periodoLabel.toUpperCase()} — ${clinicaNombre.toUpperCase()}:
- Total presupuestos presentados: ${datos.total}
- Aceptados: ${datos.aceptados} (tasa: ${datos.tasa}%)
- Perdidos: ${datos.perdidos}
- En pipeline activo: ${datos.activos} (€${datos.importePipeline.toLocaleString("es-ES")} en juego)
- Importe total aceptado: €${datos.importeTotal.toLocaleString("es-ES")}

Desglose por tarifa:
  - Privado: ${datos.privados.total} presupuestos, tasa ${datos.privados.tasa}%
  - Adeslas: ${datos.adeslas.total} presupuestos, tasa ${datos.adeslas.tasa}%

Rendimiento por doctor (top 5):
${doctoresStr || "  - Sin datos"}

Captación por canal de origen:
${origenStr || "  - Sin datos"}

Principales motivos de pérdida:
${motivosStr}

INSTRUCCIONES:
- Redacta un informe narrativo de 3-5 párrafos en español
- Tono: profesional pero directo, orientado a acción
- Incluye: resumen ejecutivo, puntos fuertes, áreas de mejora, y 2-3 recomendaciones concretas
- Usa los números del informe para argumentar cada punto
- NO incluyas títulos ni encabezados — solo texto corrido en párrafos
- NO inventes datos que no están en el informe`;
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
  const presupuestos = await fetchPresupuestosMes(clinicaFiltro, mes);
  if (!presupuestos || presupuestos.length === 0) {
    return NextResponse.json({ error: "No hay datos para el mes y clínica seleccionados." }, { status: 404 });
  }

  const datos = buildDatosResumen(presupuestos);
  const clinicaNombre = clinicaId === "todas" ? "Todas las clínicas" : clinicaId;
  const prompt = buildPrompt(mes, clinicaNombre, datos);

  try {
    const msg = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
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
