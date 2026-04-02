// app/api/informes/generar-ppt/route.ts
// POST — genera presentación PPT mensual usando pptxgenjs
// Gráficos generados server-side con chartjs-node-canvas
//
// Body: { mes, clinica, informe, datos: KpiResumen }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import PptxGenJS from "pptxgenjs";
import { graficoLineas, graficoBarsHorizontal, graficoBarsVertical } from "../../../lib/charts/generar";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch { return false; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TendenciaMes = { mes: string; label: string; total: number; aceptados: number };
type ClinicaKpi = { clinica: string; total: number; aceptados: number; importeTotal: number; tasa: number };
type DoctorKpi = { doctor: string; total: number; aceptados: number; tasa: number };
type KpiResumen = {
  total: number; aceptados: number; perdidos: number; activos: number;
  tasa: number; importeTotal: number; importePipeline: number;
  porDoctor: DoctorKpi[];
  porOrigen: { origen: string; count: number }[];
  porMotivo: { motivo: string; count: number }[];
  privados: { total: number; tasa: number };
  adeslas: { total: number; tasa: number };
  tendenciaMensual?: TendenciaMes[];
  porClinica?: ClinicaKpi[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MES_LABEL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function mesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MES_LABEL[m - 1]} ${y}`;
}

function euro(n: number): string {
  return `€${n.toLocaleString("es-ES")}`;
}

function plainText(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

function semaforo(tasa: number): string {
  if (tasa >= 40) return "16A34A"; // green
  if (tasa >= 20) return "EA580C"; // orange
  return "DC2626";                  // red
}

/** Compute 3-month rolling average for forecasting */
function computeProyeccion(tendencia: TendenciaMes[], mesSiguiente: string): { mes: string; label: string; proyTotal: number; proyAcept: number }[] {
  const last3 = tendencia.slice(-3);
  const avgTotal = last3.length > 0 ? Math.round(last3.reduce((s, t) => s + t.total, 0) / last3.length) : 0;
  const avgTasa = last3.length > 0 ? last3.reduce((s, t) => s + (t.total > 0 ? t.aceptados / t.total : 0), 0) / last3.length : 0;

  const result = [];
  const [baseY, baseM] = mesSiguiente.split("-").map(Number);
  for (let i = 0; i < 3; i++) {
    let m = baseM + i;
    let y = baseY;
    while (m > 12) { m -= 12; y++; }
    const mesStr = `${y}-${String(m).padStart(2, "0")}`;
    result.push({
      mes: mesStr,
      label: `${MES_SHORT[m - 1]} ${y}`,
      proyTotal: avgTotal,
      proyAcept: Math.round(avgTotal * avgTasa),
    });
  }
  return result;
}

const PRIMARY = "7C3AED";
const WHITE = "FFFFFF";
const DARK = "1E293B";
const MUTED = "64748B";
const LIGHT_BG = "F8FAFC";
const GREEN = "16A34A";

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { mes, clinica, informe, datos }: {
      mes: string; clinica: string; informe: string; datos: KpiResumen;
    } = body;

    if (!mes || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    // Generate charts server-side in parallel
    const [pngLinea, pngMotivos, pngDoctores, pngCanales] = await Promise.all([
      graficoLineas(datos.tendenciaMensual ?? [], mes),
      graficoBarsHorizontal(datos.porMotivo.map(m => ({ label: m.motivo, value: m.count })), "#DC2626"),
      graficoBarsVertical(datos.porDoctor.slice(0, 8).map(d => ({ label: d.doctor, total: d.total, aceptados: d.aceptados }))),
      graficoBarsVertical(datos.porOrigen.map(o => ({ label: o.origen, total: o.count }))),
    ]);

    const label = mesLabel(mes);
    const labelCaps = label.charAt(0).toUpperCase() + label.slice(1);
    const clinicaName = clinica ?? "Clínicas";
    const parrafos = informe.split("\n\n").filter(Boolean).map(p => plainText(p.trim()));

    // Compute next-month proyeccion
    const [mesY, mesM] = mes.split("-").map(Number);
    let sigMes = mesM + 1; let sigY = mesY;
    if (sigMes > 12) { sigMes = 1; sigY++; }
    const mesSiguiente = `${sigY}-${String(sigMes).padStart(2, "0")}`;
    const proyeccion = computeProyeccion(datos.tendenciaMensual ?? [], mesSiguiente);

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Fyllio CRM";
    pptx.title = `Informe ${labelCaps} — ${clinicaName}`;
    pptx.subject = "Informe mensual de presupuestos";

    // ── Slide 1 — Portada ───────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: PRIMARY };
      s.addShape(pptx.ShapeType.rect, { x: 3.5, y: 4.8, w: 3, h: 0.06, fill: { color: "A78BFA" }, line: { color: "A78BFA", width: 0 } });
      s.addText("INFORME MENSUAL\nDE PRESUPUESTOS", {
        x: 1, y: 1.4, w: 8, h: 2, fontSize: 40, bold: true, color: WHITE, align: "center", charSpacing: 0.5,
      });
      s.addText(`${labelCaps.toUpperCase()} · ${clinicaName}`, {
        x: 1, y: 3.5, w: 8, h: 0.6, fontSize: 16, color: "EDE9FE", align: "center",
      });
      s.addText(`Generado con IA · Confidencial · ${datos.total} presupuestos`, {
        x: 1, y: 5.1, w: 8, h: 0.4, fontSize: 10, color: "C4B5FD", align: "center",
      });
    }

    // ── Slide 2 — Resumen ejecutivo ──────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText(`Resumen — ${labelCaps}`, {
        x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY,
      });
      // 4 tarjetas KPI con números grandes
      const metrics = [
        { label: "Presupuestos", value: String(datos.total), color: DARK },
        { label: `Aceptados (${datos.tasa}%)`, value: String(datos.aceptados), color: GREEN },
        { label: "€ Aceptado", value: euro(datos.importeTotal), color: "7C3AED" },
        { label: "Pipeline activo", value: String(datos.activos), color: "EA580C" },
      ];
      metrics.forEach((m, i) => {
        const x = 0.2 + i * 2.45;
        s.addShape(pptx.ShapeType.rect, { x, y: 1.0, w: 2.25, h: 1.3, fill: { color: LIGHT_BG }, line: { color: "E2E8F0", width: 1 } });
        s.addText(m.value, { x, y: 1.1, w: 2.25, h: 0.65, fontSize: 26, bold: true, color: m.color, align: "center", valign: "middle" });
        s.addText(m.label.toUpperCase(), { x, y: 1.8, w: 2.25, h: 0.35, fontSize: 7.5, color: MUTED, align: "center" });
      });
      // Bullets narrativos
      const bullets = parrafos.slice(0, 3);
      bullets.forEach((b, i) => {
        s.addText(`• ${b}`, {
          x: 0.3, y: 2.5 + i * 0.95, w: 9.4, h: 0.85,
          fontSize: 9, color: DARK, wrap: true, valign: "top",
        });
      });
    }

    // ── Slide 3 — Evolución 12 meses ────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Evolución — últimos 12 meses", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      if (pngLinea) {
        s.addImage({ data: `data:image/png;base64,${pngLinea}`, x: 0.4, y: 0.95, w: 6.2, h: 3.5 });
      } else {
        s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.95, w: 6.2, h: 3.5, fill: { color: "F1F5F9" }, line: { color: "E2E8F0", width: 1 } });
        s.addText("Sin datos de evolución", { x: 0.4, y: 2.5, w: 6.2, h: 0.5, fontSize: 12, color: MUTED, align: "center" });
      }
      // 3 bullets métricas laterales
      const tendRecent = (datos.tendenciaMensual ?? []).slice(-3);
      const tendBullets = tendRecent.map(t =>
        `${t.label}: ${t.total} ofrecidos · ${t.aceptados} aceptados (${t.total > 0 ? Math.round(t.aceptados / t.total * 100) : 0}%)`
      );
      if (tendBullets.length > 0) {
        s.addText("Últimos 3 meses:", { x: 6.8, y: 1.1, w: 3, h: 0.4, fontSize: 10, bold: true, color: PRIMARY });
        tendBullets.forEach((b, i) => {
          s.addShape(pptx.ShapeType.rect, { x: 6.8, y: 1.6 + i * 0.9, w: 3, h: 0.75, fill: { color: LIGHT_BG }, line: { color: "E2E8F0", width: 1 } });
          s.addText(b, { x: 6.85, y: 1.65 + i * 0.9, w: 2.9, h: 0.65, fontSize: 8.5, color: DARK, wrap: true, valign: "middle" });
        });
      }
    }

    // ── Slide 4 — Red de clínicas ────────────────────────────────────────────
    if (datos.porClinica && datos.porClinica.length > 0) {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Estado de la red de clínicas", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      datos.porClinica.slice(0, 5).forEach((c, i) => {
        const col = Math.floor(i / 3);
        const row = i % 3;
        const x = 0.3 + col * 4.9;
        const y = 1.0 + row * 1.35;
        const bColor = semaforo(c.tasa);
        s.addShape(pptx.ShapeType.rect, { x, y, w: 4.5, h: 1.2, fill: { color: WHITE }, line: { color: bColor, width: 2.5 } });
        s.addText(c.clinica, { x: x + 0.15, y: y + 0.08, w: 3.5, h: 0.35, fontSize: 11, bold: true, color: DARK });
        s.addText(`${c.total} presupuestos · ${c.aceptados} aceptados`, { x: x + 0.15, y: y + 0.45, w: 3.5, h: 0.3, fontSize: 8.5, color: MUTED });
        s.addText(`${c.tasa}%`, { x: x + 0.15, y: y + 0.78, w: 1.5, h: 0.32, fontSize: 16, bold: true, color: bColor });
        s.addText("tasa conv.", { x: x + 1.3, y: y + 0.86, w: 1.5, h: 0.25, fontSize: 7.5, color: MUTED });
        s.addText(euro(c.importeTotal), { x: x + 2.5, y: y + 0.78, w: 1.85, h: 0.35, fontSize: 9.5, bold: true, color: "7C3AED", align: "right" });
      });
    }

    // ── Slide 5 — Barreras de conversión ─────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Principales barreras de conversión", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      if (pngMotivos) {
        s.addImage({ data: `data:image/png;base64,${pngMotivos}`, x: 0.4, y: 0.95, w: 5.2, h: 3.8 });
      }
      const rows: [string, string, string][] = [["Motivo", "Casos", "%"]];
      datos.porMotivo.slice(0, 5).forEach(m => {
        rows.push([m.motivo, String(m.count), `${datos.perdidos > 0 ? Math.round(m.count / datos.perdidos * 100) : 0}%`]);
      });
      s.addTable(rows.map((r, ri) => r.map(cell => ({
        text: cell,
        options: {
          bold: ri === 0,
          fontSize: ri === 0 ? 8 : 9,
          color: ri === 0 ? MUTED : DARK,
          fill: ri === 0 ? { color: "F1F5F9" } : { color: ri % 2 === 0 ? WHITE : "F8FAFC" },
          border: { type: "solid", pt: 0.5, color: "E2E8F0" },
          align: "left" as const,
        },
      }))), { x: 5.9, y: 1.0, w: 3.6, fontSize: 9 });
      if (parrafos[2]) {
        s.addText(parrafos[2].slice(0, 200), { x: 0.4, y: 4.95, w: 9.2, h: 0.65, fontSize: 8.5, color: MUTED, wrap: true });
      }
    }

    // ── Slide 6 — Equipo médico ───────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Rendimiento del equipo médico", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      if (pngDoctores) {
        s.addImage({ data: `data:image/png;base64,${pngDoctores}`, x: 0.4, y: 0.95, w: 4.8, h: 3.6 });
      }
      const rows: [string, string, string, string][] = [["Doctor", "Total", "Acept.", "Tasa"]];
      datos.porDoctor.slice(0, 6).forEach(d => {
        const emoji = d.tasa >= 40 ? "✓" : d.tasa < 20 ? "↓" : "~";
        rows.push([`${emoji} ${d.doctor}`, String(d.total), String(d.aceptados), `${d.tasa}%`]);
      });
      s.addTable(rows.map((r, ri) => r.map(cell => ({
        text: cell,
        options: {
          bold: ri === 0,
          fontSize: ri === 0 ? 8 : 9,
          color: ri === 0 ? MUTED : DARK,
          fill: ri === 0 ? { color: "F1F5F9" } : { color: ri % 2 === 0 ? WHITE : "F8FAFC" },
          border: { type: "solid", pt: 0.5, color: "E2E8F0" },
          align: "left" as const,
        },
      }))), { x: 5.5, y: 1.0, w: 4.0, fontSize: 9 });
      if (parrafos[1]) {
        s.addText(parrafos[1].slice(0, 180), { x: 0.4, y: 4.75, w: 9.2, h: 0.75, fontSize: 8.5, color: MUTED, wrap: true });
      }
    }

    // ── Slide 7 — Canales de captación ───────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("¿De dónde vienen los pacientes?", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      if (pngCanales) {
        s.addImage({ data: `data:image/png;base64,${pngCanales}`, x: 0.4, y: 0.95, w: 5.2, h: 3.6 });
      }
      // Table right
      const rows: [string, string, string][] = [["Canal", "Vol.", "%"]];
      datos.porOrigen.slice(0, 6).forEach(o => {
        rows.push([o.origen, String(o.count), `${datos.total > 0 ? Math.round(o.count / datos.total * 100) : 0}%`]);
      });
      s.addTable(rows.map((r, ri) => r.map(cell => ({
        text: cell,
        options: {
          bold: ri === 0,
          fontSize: ri === 0 ? 8 : 9,
          color: ri === 0 ? MUTED : DARK,
          fill: ri === 0 ? { color: "F1F5F9" } : { color: ri % 2 === 0 ? WHITE : "F8FAFC" },
          border: { type: "solid", pt: 0.5, color: "E2E8F0" },
          align: "left" as const,
        },
      }))), { x: 5.9, y: 1.0, w: 3.6, fontSize: 9 });
      if (parrafos[3]) {
        s.addText(parrafos[3].slice(0, 200), { x: 0.4, y: 4.75, w: 9.2, h: 0.75, fontSize: 8.5, color: MUTED, wrap: true });
      }
    }

    // ── Slide 8 — Forecasting ────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Proyección próximos 3 meses", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      s.addText("Basado en la media de los últimos 3 meses · Estimación orientativa", {
        x: 0.4, y: 0.85, w: 9.2, h: 0.35, fontSize: 9, color: MUTED,
      });
      const confianzaLabel = (datos.tendenciaMensual ?? []).filter(t => t.total > 0).length >= 6 ? "Alta" : "Moderada";
      proyeccion.forEach((p, i) => {
        const x = 0.5 + i * 3.1;
        s.addShape(pptx.ShapeType.rect, { x, y: 1.35, w: 2.8, h: 2.8, fill: { color: LIGHT_BG }, line: { color: "E2E8F0", width: 1 } });
        s.addText(p.label, { x, y: 1.5, w: 2.8, h: 0.45, fontSize: 12, bold: true, color: PRIMARY, align: "center" });
        s.addText(String(p.proyTotal), { x, y: 2.0, w: 2.8, h: 0.75, fontSize: 36, bold: true, color: DARK, align: "center" });
        s.addText("presupuestos estimados", { x, y: 2.78, w: 2.8, h: 0.35, fontSize: 8, color: MUTED, align: "center" });
        s.addText(`${p.proyAcept} aceptados (est.)`, { x, y: 3.15, w: 2.8, h: 0.35, fontSize: 9, color: GREEN, align: "center", bold: true });
        s.addText(`Confianza: ${confianzaLabel}`, { x, y: 3.6, w: 2.8, h: 0.3, fontSize: 8, color: MUTED, align: "center" });
      });
    }

    // ── Slide 9 — Plan de acción ─────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Plan de acción", { x: 0.4, y: 0.25, w: 9.2, h: 0.6, fontSize: 22, bold: true, color: PRIMARY });
      const planText = parrafos[parrafos.length - 1] ?? "";
      const actions = planText.split(/(?=\d\.)/).filter(Boolean).slice(0, 3);
      // Fallback: split by sentences if no numbered list
      const items = actions.length >= 2 ? actions : planText.split(/[.!]/).filter(s => s.trim().length > 20).slice(0, 3);
      items.forEach((a, i) => {
        const y = 1.15 + i * 1.5;
        s.addShape(pptx.ShapeType.ellipse, { x: 0.35, y, w: 0.55, h: 0.55, fill: { color: PRIMARY } });
        s.addText(String(i + 1), { x: 0.35, y, w: 0.55, h: 0.55, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle" });
        s.addShape(pptx.ShapeType.rect, { x: 1.05, y: y - 0.1, w: 8.5, h: 1.3, fill: { color: LIGHT_BG }, line: { color: "E2E8F0", width: 1 } });
        s.addText(a.trim(), { x: 1.2, y: y - 0.05, w: 8.2, h: 1.2, fontSize: 9.5, color: DARK, wrap: true, valign: "middle" });
      });
    }

    // ── Slide 10 — Cierre ─────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: PRIMARY };
      s.addText("¿Preguntas?", {
        x: 1, y: 2.0, w: 8, h: 1.4, fontSize: 40, bold: true, color: WHITE, align: "center", valign: "middle",
      });
      s.addText(`${clinicaName} · ${labelCaps}`, {
        x: 1, y: 3.5, w: 8, h: 0.5, fontSize: 14, color: "EDE9FE", align: "center",
      });
      s.addText("Informe generado con Fyllio CRM · Confidencial", {
        x: 1, y: 4.2, w: 8, h: 0.4, fontSize: 10, color: "C4B5FD", align: "center",
      });
    }

    // Render to buffer
    const pptBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;

    const [y, m] = mes.split("-");
    const fileLabel = `${MES_LABEL[Number(m) - 1]}_${y}`;
    const filename = `Presentacion_${fileLabel}_${(clinicaName).replace(/\s+/g, "_")}.pptx`;

    return new Response(new Uint8Array(pptBuffer as Buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String((pptBuffer as Buffer).byteLength),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
