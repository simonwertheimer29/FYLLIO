// app/api/presupuestos/ia/informe/route.ts
// Generates a monthly narrative report using Claude Sonnet.
// POST { mes: "YYYY-MM", clinicaId: "todas" | string }

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../../../lib/presupuestos/repo";
import Anthropic from "@anthropic-ai/sdk";
import { construirMapaAnonimizacion, desanonimizarTexto } from "../../../../lib/anonimizacion";
import { DateTime } from "luxon";
import { ESTADOS_ACEPTADOS } from "../../../../lib/presupuestos/colors";
import { tasaCierre, textoTasa, notaTasa } from "../../../../lib/presupuestos/tasa";
import type { Presupuesto } from "../../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

const ORIGEN_DISPLAY: Record<string, string> = {
  google_ads: "Google Ads", seo_organico: "Google orgánico", referido_paciente: "Referido",
  redes_sociales: "Redes sociales", walk_in: "Visita directa", otro: "Otro",
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

    const recs = await selectPresupuestosRaw(selectOpts);
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
        contactCount: Number(f["ContactCount"] ?? 0),
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
        motivoDuda: f["MotivoDuda"] ?? undefined,
      };
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
  // La MISMA tasa que /kpis y que la cabecera de /presupuestos. Este informe se
  // narra con IA y se GUARDA: una tasa distinta aquí queda escrita en un
  // documento que luego nadie recalcula.
  const tasa = tasaCierre(presupuestos);
  const importeTotal = aceptados.reduce((s, p) => s + (p.amount ?? 0), 0);
  const importePipeline = activos.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Por doctor
  const docMap = new Map<string, Presupuesto[]>();
  presupuestos.forEach((p) => {
    const k = p.doctor ?? "Sin doctor";
    const arr = docMap.get(k);
    if (arr) arr.push(p); else docMap.set(k, [p]);
  });
  const porDoctor = [...docMap.entries()]
    .map(([doctor, ps]) => ({
      doctor,
      total: ps.length,
      aceptados: ps.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado)).length,
      tasa: tasaCierre(ps),
    }))
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

  // Tipo paciente — el catálogo es configurable por clínica (decisión
  // 2026-07-29): se miden los valores que HAY, no dos literales escritos a mano
  // que vienen de un cliente concreto y dejaban ceros en cualquier otro.
  const porTipoPaciente = [
    ...new Set(presupuestos.map((p) => p.tipoPaciente).filter((t): t is string => !!t)),
  ]
    .map((tipo) => {
      const list = presupuestos.filter((p) => p.tipoPaciente === tipo);
      return { tipo, total: list.length, tasa: tasaCierre(list) };
    })
    .sort((a, b) => b.total - a.total);

  // Tendencia mensual — últimos 12 meses (desde allPresupuestos sin filtro de clínica)
  const tendenciaMensual: { mes: string; label: string; total: number; aceptados: number; perdidos: number }[] = [];
  if (mes) {
    const [mesY, mesM] = mes.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      let y = mesY;
      let m = mesM - i;
      while (m <= 0) { m += 12; y--; }
      const mesStr = `${y}-${String(m).padStart(2, "0")}`;
      const delMes = allPresupuestos.filter((p) => p.fechaPresupuesto.startsWith(mesStr));
      const t = tasaCierre(delMes);
      tendenciaMensual.push({
        mes: mesStr, label: MES_SHORT[m - 1], total: delMes.length,
        aceptados: t.aceptados, perdidos: t.perdidos,
      });
    }
  }

  // Por clínica (desde allPresupuestos sin filtro de mes)
  const clinicaMap = new Map<string, Presupuesto[]>();
  allPresupuestos.forEach((p) => {
    const k = p.clinica ?? "Sin clínica";
    const arr = clinicaMap.get(k);
    if (arr) arr.push(p); else clinicaMap.set(k, [p]);
  });
  const porClinica = [...clinicaMap.entries()]
    .map(([clinica, ps]) => ({
      clinica,
      total: ps.length,
      aceptados: ps.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado)).length,
      importeTotal: ps
        .filter((p) => ESTADOS_ACEPTADOS.includes(p.estado))
        .reduce((s, p) => s + (p.amount ?? 0), 0),
      tasa: tasaCierre(ps),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total, aceptados: aceptados.length, perdidos: perdidos.length, activos: activos.length,
    tasa, importeTotal, importePipeline,
    porDoctor, porOrigen, porMotivo,
    porTipoPaciente,
    tendenciaMensual,
    porClinica,
  };
}

function buildPrompt(mes: string, clinicaNombre: string, datos: ReturnType<typeof buildDatosResumen>): string {
  const [y, m] = mes.split("-").map(Number);
  const mesLabel = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][m - 1];
  const periodoLabel = `${mesLabel} de ${y}`;

  // La IA narra lo que le damos: si le pasamos una tasa sin su denominador,
  // escribe frases sobre un número que no significa lo que parece.
  const doctoresStr = datos.porDoctor.slice(0, 5)
    .map((d) => `  - ${d.doctor}: ${d.total} presupuestos, ${d.aceptados} aceptados · acepta ${textoTasa(d.tasa)} del € presentado (${notaTasa(d.tasa)})`)
    .join("\n");
  const tipoPacienteStr = datos.porTipoPaciente
    .map((t) => `  - ${t.tipo}: ${t.total} presupuestos, acepta ${textoTasa(t.tasa)} del € presentado (${notaTasa(t.tasa)})`)
    .join("\n");
  const origenStr = datos.porOrigen.slice(0, 4)
    .map((o) => `  - ${o.origen}: ${o.count}`)
    .join("\n");
  const motivosStr = datos.porMotivo.length > 0
    ? datos.porMotivo.slice(0, 3).map((m) => `  - ${m.motivo}: ${m.count}`).join("\n")
    : "  - Sin datos suficientes";

  return `Eres analista de negocio de una red de clínicas dentales en España.

DATOS DE ${periodoLabel.toUpperCase()} — ${clinicaNombre.toUpperCase()}:
- Total presupuestos: ${datos.total} | Aceptados: ${datos.aceptados} | Perdidos: ${datos.perdidos} | Sin decidir todavía: ${datos.tasa.abiertos}
- Tasa de aceptación: ${textoTasa(datos.tasa)} del € presentado — ${notaTasa(datos.tasa)}. IMPORTANTE: se mide en EUROS (€ aceptado sobre € presentado). Lo que sigue abierto entra en el denominador pero NO es rechazo: no lo trates como pérdida, dilo como «aún sin decidir».
- Importe aceptado: €${datos.importeTotal.toLocaleString("es-ES")} | Pipeline activo: €${datos.importePipeline.toLocaleString("es-ES")}
Por tipo de paciente:
${tipoPacienteStr || "  - Sin datos"}

Doctores (top 5):
${doctoresStr || "  - Sin datos"}

Captación por canal:
${origenStr || "  - Sin datos"}

Motivos de pérdida:
${motivosStr}

Genera un informe ejecutivo con EXACTAMENTE esta estructura (5 párrafos, sin títulos):

PÁRRAFO 1 — RESUMEN GLOBAL: tasa del mes, importe aceptado, comparativa si hay datos del mes anterior.
PÁRRAFO 2 — ANÁLISIS: doctor con mejor tasa y el que más necesita mejora (con números). Diferencias por tipo de paciente si son relevantes.
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

export const POST = withPresupuestosAuth(async (session, req: Request) => {

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
  // Sprint B Fase 4 — un usuario restringido (coord) solo puede pedir el informe
  // de UNA de sus clínicas permitidas: ni "todas" (red) ni otra clínica.
  const permitidas = await nombresClinicasPermitidas(session);
  if (permitidas !== null && !(body.clinicaId && permiteClinica(permitidas, body.clinicaId))) {
    return NextResponse.json(
      { error: "Debes seleccionar una de tus clínicas" },
      { status: 403 },
    );
  }
  const clinicaId: string = body.clinicaId ?? "todas";
  const clinicaFiltro = clinicaId === "todas" ? null : clinicaId;

  // Fetch data
  const { filtered: presupuestos, all } = await fetchPresupuestosMes(clinicaFiltro, mes);
  if (!presupuestos || presupuestos.length === 0) {
    return NextResponse.json({ error: "No hay datos para el mes y clínica seleccionados." }, { status: 404 });
  }

  const datos = buildDatosResumen(presupuestos, all, mes);
  const clinicaNombre = clinicaId === "todas" ? "Todas las clínicas" : clinicaId;

  // ── Anonimización de clínica para Claude API ───────────────────────────────
  const anonMap = construirMapaAnonimizacion(clinicaId !== "todas" ? [clinicaNombre] : []);
  const clinicaNombreAnon = anonMap.realToAlias.get(clinicaNombre) ?? clinicaNombre;

  const prompt = buildPrompt(mes, clinicaNombreAnon, datos);

  try {
    const msg = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });

    const informeRaw = (msg.content[0] as { type: string; text: string }).text ?? "";
    // Restaurar nombres reales antes de devolver al cliente
    const informe = desanonimizarTexto(informeRaw, anonMap);

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
});
