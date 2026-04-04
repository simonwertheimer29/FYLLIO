// app/api/informes/generar-ppt/route.ts
// POST — genera presentación PPT mensual — 10 slides V5c
// Gráficos generados server-side con chartjs-node-canvas
//
// Body: { mes, clinica, informe, datos: KpiResumen }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import PptxGenJS from "pptxgenjs";
import {
  graficoLineas,
  graficoBarrasH,
  graficoBarrasV,
  graficoForecast,
  graficoAB,
} from "../../../lib/charts/svg-charts";

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
  abTonos?: { tono: string; mensajes: number; aceptados: number; tasa: number }[];
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

function semaforoColor(tasa: number, media: number): string {
  if (tasa >= media * 1.1) return "16A34A"; // green
  if (tasa >= media * 0.8) return "D97706"; // orange
  return "DC2626";                           // red
}

function proyeccionMeses(tendencia: TendenciaMes[], mes: string): { mes: string; valor: number }[] {
  const last3 = tendencia.slice(-3).filter((t) => t.total > 0);
  const avgTotal = last3.length ? Math.round(last3.reduce((s, t) => s + t.total, 0) / last3.length) : 0;
  const avgTasa = last3.length ? last3.reduce((s, t) => s + (t.total > 0 ? t.aceptados / t.total : 0), 0) / last3.length : 0;
  const avgImporte = 850;
  const [y, m] = mes.split("-").map(Number);
  return [1, 2, 3].map((i) => {
    let mo = m + i; let yr = y;
    if (mo > 12) { mo -= 12; yr++; }
    return { mes: `${MES_SHORT[mo - 1]} ${yr}`, valor: Math.round(avgTotal * avgTasa * avgImporte * (1 - i * 0.1)) };
  });
}

// ─── Color palette ────────────────────────────────────────────────────────────

const BG_DARK = "1E1B4B";
const PRIMARY = "7C3AED";
const WHITE = "FFFFFF";
const DARK = "1E293B";
const MUTED = "64748B";
const LIGHT = "F8FAFC";
const PURPLE_LIGHT = "F5F3FF";
const GREEN = "16A34A";
const ORANGE = "D97706";
const RED = "DC2626";

// ─── Shared table cell helper ─────────────────────────────────────────────────

type CellOpts = {
  text: string;
  bold?: boolean;
  fontSize?: number;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
};

function cell(opts: CellOpts) {
  return {
    text: opts.text,
    options: {
      bold: opts.bold ?? false,
      fontSize: opts.fontSize ?? 9,
      color: opts.color ?? DARK,
      fill: opts.fill ? { color: opts.fill } : undefined,
      border: { type: "solid" as const, pt: 0.5, color: "E5E7EB" },
      align: opts.align ?? "left",
    },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { mes, clinica, informe, datos, charts: clientCharts } = body as {
      mes: string; clinica: string; informe: string; datos: KpiResumen;
      charts?: Record<string, string>;
    };

    if (!mes || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    // Diagnostic logging — visible in Vercel function logs
    const clientChartKeys = Object.keys(clientCharts ?? {}).filter(
      (k) => (clientCharts?.[k]?.length ?? 0) > 100
    );
    console.log("[generar-ppt] request:", {
      mes,
      clinica,
      total: datos.total,
      tendenciaMeses: datos.tendenciaMensual?.length ?? 0,
      porClinica: datos.porClinica?.length ?? 0,
      porDoctor: datos.porDoctor?.length ?? 0,
      clientCharts: clientChartKeys,
    });

    const label = mesLabel(mes);
    const labelCaps = label.charAt(0).toUpperCase() + label.slice(1);
    const clinicaName = clinica ?? "Clínicas";
    const parrafos = informe.split("\n\n").filter(Boolean).map((p) => plainText(p.trim()));
    const mediaRed = datos.total > 0 ? Math.round(datos.aceptados / datos.total * 100) : 0;
    const proyeccion = proyeccionMeses(datos.tendenciaMensual ?? [], mes);

    // Use client-captured charts (from Recharts/html2canvas) if available; generate server-side as fallback
    const useChart = (key: string) =>
      typeof clientCharts?.[key] === "string" && (clientCharts[key] as string).length > 100;
    const fromClient = (key: string): string => clientCharts?.[key] ?? "";

    const [bufLinea, bufClinicas, bufMotivos, bufDoctores, bufCanales, bufForecast, bufAB] =
      await Promise.all([
        useChart("linea") ? Promise.resolve(null) : graficoLineas(
          (datos.tendenciaMensual ?? []).map((t) => ({ label: t.label, ofrecidos: t.total, aceptados: t.aceptados }))
        ),
        useChart("clinicas") ? Promise.resolve(null) : graficoBarrasH(
          (datos.porClinica ?? []).map((c) => ({
            label: c.clinica,
            value: c.tasa,
            color: c.tasa >= mediaRed ? "#16A34A" : "#DC2626",
          }))
        ),
        useChart("motivos") ? Promise.resolve(null) : graficoBarrasH(
          datos.porMotivo.map((m) => ({ label: m.motivo, value: m.count, color: "#DC2626" }))
        ),
        useChart("doctores") ? Promise.resolve(null) : graficoBarrasV(
          datos.porDoctor.slice(0, 8).map((d) => ({ label: d.doctor, value: d.tasa })),
          mediaRed
        ),
        useChart("canales") ? Promise.resolve(null) : graficoBarrasH(
          datos.porOrigen.map((o) => ({ label: o.origen, value: o.count, color: "#7C3AED" }))
        ),
        useChart("forecast") ? Promise.resolve(null) : graficoForecast(
          proyeccion.map((p, i) => ({
            mes: p.mes,
            valor: p.valor,
            color: ["#16A34A", "#D97706", "#9CA3AF"][i],
          }))
        ),
        useChart("ab") ? Promise.resolve(null) : (
          (datos.abTonos?.length ?? 0) > 0
            ? graficoAB(datos.abTonos!.map((t) => ({ tono: t.tono, tasa: t.tasa, mensajes: t.mensajes })))
            : Promise.resolve(null)
        ),
      ]);

    // Resolve final base64 strings: prefer client charts, fall back to server-generated
    const toB64 = (b: Buffer | null): string => b ? b.toString("base64") : "";
    const pngLinea    = useChart("linea")    ? fromClient("linea")    : toB64(bufLinea);
    const pngClinicas = useChart("clinicas") ? fromClient("clinicas") : toB64(bufClinicas);
    const pngMotivos  = useChart("motivos")  ? fromClient("motivos")  : toB64(bufMotivos);
    const pngDoctores = useChart("doctores") ? fromClient("doctores") : toB64(bufDoctores);
    const pngCanales  = useChart("canales")  ? fromClient("canales")  : toB64(bufCanales);
    const pngForecast = useChart("forecast") ? fromClient("forecast") : toB64(bufForecast);
    const pngAB       = useChart("ab")       ? fromClient("ab")       : toB64(bufAB);

    console.log("[generar-ppt] charts:", {
      linea:    pngLinea    ? (useChart("linea")    ? "CLIENT" : "SERVER") : "EMPTY",
      clinicas: pngClinicas ? (useChart("clinicas") ? "CLIENT" : "SERVER") : "EMPTY",
      motivos:  pngMotivos  ? (useChart("motivos")  ? "CLIENT" : "SERVER") : "EMPTY",
      doctores: pngDoctores ? (useChart("doctores") ? "CLIENT" : "SERVER") : "EMPTY",
      canales:  pngCanales  ? (useChart("canales")  ? "CLIENT" : "SERVER") : "EMPTY",
      forecast: pngForecast ? (useChart("forecast") ? "CLIENT" : "SERVER") : "EMPTY",
      ab:       pngAB       ? (useChart("ab")       ? "CLIENT" : "SERVER") : "EMPTY",
    });

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Fyllio CRM";
    pptx.title = `Informe ${labelCaps} — ${clinicaName}`;

    // ── S1 — Portada ─────────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: BG_DARK };
      // Barra vertical decorativa izquierda
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 2.0, w: 0.09, h: 4.5, fill: { color: PRIMARY },
      });
      s.addText("INFORME MENSUAL\nDE PRESUPUESTOS", {
        x: 0.6, y: 1.2, w: 9, h: 2.2,
        fontSize: 44, bold: true, color: WHITE, fontFace: "Calibri",
      });
      s.addShape(pptx.ShapeType.rect, {
        x: 0.6, y: 3.45, w: 2.4, h: 0.07, fill: { color: PRIMARY },
      });
      s.addText(`${labelCaps.toUpperCase()} · ${clinicaName}`, {
        x: 0.6, y: 3.65, w: 12, h: 0.6,
        fontSize: 22, color: "A5B4FC", fontFace: "Calibri",
      });
      s.addText(`${datos.total} presupuestos · Generado con IA · Confidencial`, {
        x: 0.6, y: 5.1, w: 12, h: 0.4,
        fontSize: 13, color: "4B5563", fontFace: "Calibri",
      });
    }

    // ── S2 — Resumen ejecutivo ────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      // Barra top
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText(`${labelCaps} en números`, {
        x: 0.5, y: 0.28, w: 9, h: 0.65, fontSize: 28, bold: true, color: DARK, fontFace: "Calibri",
      });
      // 4 cajas KPI con número grande
      const kpis = [
        { val: String(datos.total), lbl: "PRESUPUESTOS", x: 0.35 },
        { val: String(datos.aceptados), lbl: `ACEPTADOS (${datos.tasa}%)`, x: 3.6 },
        { val: euro(datos.importeTotal), lbl: "IMPORTE ACEPTADO", x: 6.85 },
        { val: String(datos.activos), lbl: "PIPELINE ACTIVO", x: 10.1 },
      ];
      kpis.forEach((k) => {
        s.addShape(pptx.ShapeType.rect, {
          x: k.x, y: 1.05, w: 2.85, h: 1.9,
          fill: { color: "F5F3FF" }, line: { color: "DDD6FE", width: 1 },
        });
        s.addText(k.val, {
          x: k.x + 0.1, y: 1.2, w: 2.65, h: 1.05,
          fontSize: 38, bold: true, color: PRIMARY,
          align: "center", fontFace: "Calibri",
        });
        s.addText(k.lbl, {
          x: k.x + 0.1, y: 2.3, w: 2.65, h: 0.45,
          fontSize: 9, color: MUTED, align: "center", fontFace: "Calibri",
        });
      });
      // 3 bullets de insight
      const bullets = parrafos.slice(0, 3);
      bullets.forEach((b, i) => {
        s.addText(`● ${b.slice(0, 220)}`, {
          x: 0.4, y: 3.2 + i * 0.9, w: 12.5, h: 0.8,
          fontSize: 10, color: DARK, fontFace: "Calibri", wrap: true,
        });
      });
    }

    // ── S3 — Evolución 12 meses ───────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("Evolución — últimos 12 meses", {
        x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri",
      });
      if (pngLinea) {
        s.addImage({ data: `data:image/png;base64,${pngLinea}`, x: 0.5, y: 0.97, w: 12.3, h: 3.3 });
      } else {
        s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.97, w: 12.3, h: 3.3, fill: { color: "F1F5F9" }, line: { color: "E2E8F0", width: 1 } });
        s.addText("Gráfico de evolución", { x: 0.5, y: 2.4, w: 12.3, h: 0.5, fontSize: 14, color: MUTED, align: "center" });
      }
      // Tabla últimos 6 meses
      const last6 = (datos.tendenciaMensual ?? []).slice(-6);
      if (last6.length > 0) {
        const rows = [
          [cell({ text: "Mes", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" }),
           cell({ text: "Ofrecidos", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
           cell({ text: "Aceptados", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
           cell({ text: "Tasa", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" })],
          ...last6.map((t, i) => [
            cell({ text: `${t.label} ${t.mes.slice(0, 4)}`, fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA" }),
            cell({ text: String(t.total), fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
            cell({ text: String(t.aceptados), fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
            cell({ text: t.total > 0 ? Math.round(t.aceptados / t.total * 100) + "%" : "—",
              fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
          ]),
        ];
        s.addTable(rows, { x: 0.5, y: 4.43, w: 12.3, h: 2.1 });
      }
    }

    // ── S4 — Red de clínicas ──────────────────────────────────────────────────
    if (datos.porClinica && datos.porClinica.length > 0) {
      const s = pptx.addSlide();
      s.background = { color: LIGHT };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("Estado de la red de clínicas", {
        x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri",
      });
      datos.porClinica.slice(0, 4).forEach((c, i) => {
        const col = Math.floor(i / 2);
        const row = i % 2;
        const x = 0.35 + col * 6.55;
        const y = 1.05 + row * 2.9;
        const bColor = semaforoColor(c.tasa, mediaRed);
        // Card
        s.addShape(pptx.ShapeType.rect, {
          x, y, w: 6.2, h: 2.5,
          fill: { color: WHITE }, line: { color: bColor, width: 2.5 },
        });
        // Barra semáforo izquierda
        s.addShape(pptx.ShapeType.rect, { x, y, w: 0.1, h: 2.5, fill: { color: bColor } });
        s.addText(c.clinica, {
          x: x + 0.25, y: y + 0.12, w: 4.5, h: 0.5,
          fontSize: 18, bold: true, color: DARK, fontFace: "Calibri",
        });
        s.addText(`${c.tasa}%`, {
          x: x + 4.9, y: y + 0.08, w: 1.2, h: 0.6,
          fontSize: 32, bold: true, color: bColor, align: "right", fontFace: "Calibri",
        });
        s.addText("conversión", {
          x: x + 4.9, y: y + 0.7, w: 1.2, h: 0.3,
          fontSize: 10, color: MUTED, align: "right", fontFace: "Calibri",
        });
        s.addText(`${c.total} presupuestos  ·  ${c.aceptados} aceptados  ·  ${euro(c.importeTotal)}`, {
          x: x + 0.25, y: y + 0.75, w: 4.5, h: 0.35,
          fontSize: 13, color: "4B5563", fontFace: "Calibri",
        });
        if (pngClinicas) {
          // Small inline chart omitted at slide level — use full chart on separate slide
        }
      });
      // Full chart below if fits
      if (pngClinicas) {
        s.addImage({ data: `data:image/png;base64,${pngClinicas}`, x: 0.35, y: 6.1, w: 12.6, h: 0.6 });
      }
    }

    // ── S5 — Barreras de conversión ───────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("¿Por qué se pierden los presupuestos?", {
        x: 0.5, y: 0.25, w: 12, h: 0.6, fontSize: 24, bold: true, color: DARK, fontFace: "Calibri",
      });
      // Gráfico izquierda
      if (pngMotivos) {
        s.addImage({ data: `data:image/png;base64,${pngMotivos}`, x: 0.4, y: 0.97, w: 6.8, h: 5.2 });
      } else {
        s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.97, w: 6.8, h: 5.2, fill: { color: "F1F5F9" }, line: { color: "E2E8F0", width: 1 } });
      }
      // Insights derecha
      const insights = datos.porMotivo.slice(0, 3).map((m) => {
        const pct = datos.perdidos > 0 ? Math.round(m.count / datos.perdidos * 100) : 0;
        const mL = m.motivo.toLowerCase();
        let accion = "";
        if (mL.includes("precio")) accion = "Ofrecer financiación proactiva en consulta.";
        else if (mL.includes("urgencia") || mL.includes("tiempo")) accion = "Comunicar consecuencias de no tratar.";
        else if (mL.includes("clínica") || mL.includes("clinica")) accion = "Reforzar argumentario de diferenciación.";
        else if (mL.includes("responde")) accion = "Usar el asistente de mensajes para seguimiento > 3 días.";
        else accion = "Revisar protocolo de consulta.";
        return { titulo: `${pct}% — ${m.motivo}`, texto: accion };
      });
      insights.forEach((ins, i) => {
        s.addText(ins.titulo, {
          x: 7.5, y: 1.2 + i * 1.8, w: 5.4, h: 0.45,
          fontSize: 15, bold: true, color: RED, fontFace: "Calibri",
        });
        s.addShape(pptx.ShapeType.rect, {
          x: 7.5, y: 1.7 + i * 1.8, w: 5.4, h: 1.0,
          fill: { color: "FEF2F2" }, line: { color: "FECACA", width: 1 },
        });
        s.addText(ins.texto, {
          x: 7.65, y: 1.78 + i * 1.8, w: 5.1, h: 0.85,
          fontSize: 13, color: DARK, fontFace: "Calibri", wrap: true, valign: "middle",
        });
      });
      if (parrafos[2]) {
        s.addText(parrafos[2].slice(0, 180), {
          x: 0.4, y: 6.3, w: 12.5, h: 0.5,
          fontSize: 10, color: MUTED, fontFace: "Calibri", wrap: true,
        });
      }
    }

    // ── S6 — Equipo médico ────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("Rendimiento del equipo médico", {
        x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 24, bold: true, color: DARK, fontFace: "Calibri",
      });
      if (pngDoctores) {
        s.addImage({ data: `data:image/png;base64,${pngDoctores}`, x: 0.4, y: 0.97, w: 12.5, h: 3.3 });
      }
      // Highlight card
      const topDoc = datos.porDoctor.find((d) => d.total >= 3 && d.tasa >= 50);
      if (topDoc) {
        s.addShape(pptx.ShapeType.rect, {
          x: 0.4, y: 4.4, w: 12.5, h: 0.75,
          fill: { color: "F5F3FF" }, line: { color: "DDD6FE", width: 1 },
        });
        s.addText(
          `★ ${topDoc.doctor} (${topDoc.tasa}%) — ${topDoc.tasa - mediaRed}% por encima de la media de la red (${mediaRed}%). Documentar su protocolo de presentación.`,
          { x: 0.6, y: 4.5, w: 12.1, h: 0.55, fontSize: 13, color: "4C1D95", fontFace: "Calibri", wrap: true }
        );
      }
      // Tabla doctores
      const docRows = [
        [cell({ text: "Doctor", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" }),
         cell({ text: "Total", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
         cell({ text: "Acept.", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
         cell({ text: "Tasa", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
         cell({ text: "Estado", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" })],
        ...datos.porDoctor.slice(0, 6).map((d, i) => {
          const estado = d.tasa === 0 && d.total >= 3 ? "🔴 Urgente" : d.tasa >= 50 ? "✅ Referencia" : "⚠ Atención";
          const tasaC = d.tasa === 0 && d.total >= 3 ? RED : d.tasa >= 50 ? GREEN : DARK;
          const bg = i % 2 === 0 ? WHITE : "FAFAFA";
          return [
            cell({ text: d.doctor, bold: d.tasa >= 50, fontSize: 11, fill: bg }),
            cell({ text: String(d.total), fontSize: 11, fill: bg, align: "center" }),
            cell({ text: String(d.aceptados), fontSize: 11, fill: bg, align: "center" }),
            cell({ text: `${d.tasa}%`, bold: true, fontSize: 11, color: tasaC, fill: bg, align: "center" }),
            cell({ text: estado, fontSize: 10, fill: bg }),
          ];
        }),
      ];
      s.addTable(docRows, { x: 0.4, y: topDoc ? 5.3 : 4.45, w: 12.5, h: 1.8 });
    }

    // ── S7 — Canales y A/B ────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("¿De dónde vienen los pacientes?", {
        x: 0.5, y: 0.25, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: DARK, fontFace: "Calibri",
      });
      // Canales izquierda
      s.addText("ORIGEN DE LEADS", {
        x: 0.4, y: 0.97, w: 6, h: 0.35, fontSize: 11, bold: true, color: PRIMARY, fontFace: "Calibri",
      });
      if (pngCanales) {
        s.addImage({ data: `data:image/png;base64,${pngCanales}`, x: 0.4, y: 1.38, w: 6.1, h: 3.4 });
      }
      // Divisor
      s.addShape(pptx.ShapeType.line, { x: 6.85, y: 1.0, w: 0, h: 5.5, line: { color: "E5E7EB", width: 1 } });
      // Derecha: A/B tonos o tabla orígenes
      if (datos.abTonos && datos.abTonos.length > 0) {
        s.addText("A/B DE TONOS — MOTOR IA", {
          x: 7.1, y: 0.97, w: 6, h: 0.35, fontSize: 11, bold: true, color: PRIMARY, fontFace: "Calibri",
        });
        const abSorted = [...datos.abTonos].sort((a, b) => b.tasa - a.tasa);
        const abColors = [{ bg: "F0FDF4", border: "16A34A", color: GREEN }, { bg: "FFFBEB", border: "D97706", color: ORANGE }, { bg: "F9FAFB", border: "E5E7EB", color: MUTED }];
        abSorted.slice(0, 3).forEach((t, i) => {
          const col = abColors[i] ?? abColors[2];
          const y = 1.42 + i * 1.55;
          s.addShape(pptx.ShapeType.rect, { x: 7.1, y, w: 5.9, h: 1.35, fill: { color: col.bg }, line: { color: col.border, width: 1 } });
          s.addText(`${i === 0 ? "★ " : ""}${t.tono}`, {
            x: 7.25, y: y + 0.1, w: 3.5, h: 0.45, fontSize: 16, bold: true, color: col.color, fontFace: "Calibri",
          });
          s.addText(`${t.tasa}%`, {
            x: 11.2, y: y + 0.05, w: 1.7, h: 0.65, fontSize: 34, bold: true, color: col.color, align: "right", fontFace: "Calibri",
          });
          s.addText(`${t.mensajes} mensajes · ${t.aceptados} aceptados`, {
            x: 7.25, y: y + 0.75, w: 5.5, h: 0.35, fontSize: 12, color: MUTED, fontFace: "Calibri",
          });
        });
        if (pngAB) {
          s.addImage({ data: `data:image/png;base64,${pngAB}`, x: 7.1, y: 6.15, w: 5.9, h: 0.7 });
        }
      } else {
        // Sin abTonos — mostrar tabla de orígenes en derecha
        s.addText("DISTRIBUCIÓN DE CANALES", {
          x: 7.1, y: 0.97, w: 6, h: 0.35, fontSize: 11, bold: true, color: PRIMARY, fontFace: "Calibri",
        });
        const origRows = [
          [cell({ text: "Canal", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" }),
           cell({ text: "Vol.", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
           cell({ text: "%", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" })],
          ...datos.porOrigen.map((o, i) => {
            const bg = i % 2 === 0 ? WHITE : "FAFAFA";
            return [
              cell({ text: o.origen, fontSize: 11, fill: bg }),
              cell({ text: String(o.count), fontSize: 11, fill: bg, align: "center" }),
              cell({ text: datos.total > 0 ? Math.round(o.count / datos.total * 100) + "%" : "—",
                fontSize: 11, fill: bg, align: "center" }),
            ];
          }),
        ];
        s.addTable(origRows, { x: 7.1, y: 1.42, w: 5.9, h: 3.5 });
      }
      if (parrafos[3]) {
        s.addText(parrafos[3].slice(0, 200), {
          x: 0.4, y: 6.95, w: 12.5, h: 0.5,
          fontSize: 10, color: MUTED, fontFace: "Calibri", wrap: true,
        });
      }
    }

    // ── S8 — Forecasting ─────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: LIGHT };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("Proyección próximos 3 meses", {
        x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri",
      });
      s.addText("Basado en la media rolling de los últimos 3 meses · Estimación orientativa", {
        x: 0.5, y: 0.9, w: 12, h: 0.38, fontSize: 11, color: MUTED, fontFace: "Calibri",
      });
      const fColors = [
        { bg: "F0FDF4", border: GREEN, numColor: DARK },
        { bg: "FFFBEB", border: ORANGE, numColor: DARK },
        { bg: "F9FAFB", border: "9CA3AF", numColor: MUTED },
      ];
      const confianzaLabels = ["●●● Alta", "●●○ Media", "●○○ Baja"];
      const confianzaColors = [GREEN, ORANGE, MUTED];
      proyeccion.forEach((p, i) => {
        const fc = fColors[i];
        const xCard = 0.4 + i * 4.3;
        s.addShape(pptx.ShapeType.rect, {
          x: xCard, y: 1.4, w: 4.05, h: 4.55,
          fill: { color: fc.bg }, line: { color: fc.border, width: 1.5 },
        });
        s.addText(p.mes.toUpperCase(), {
          x: xCard + 0.2, y: 1.6, w: 3.65, h: 0.5,
          fontSize: 13, bold: true, color: fc.border, fontFace: "Calibri",
        });
        s.addText(euro(p.valor), {
          x: xCard + 0.15, y: 2.15, w: 3.75, h: 1.2,
          fontSize: 40, bold: true, color: fc.numColor, fontFace: "Calibri",
        });
        s.addText(confianzaLabels[i] + " confianza", {
          x: xCard + 0.2, y: 3.45, w: 3.65, h: 0.45,
          fontSize: 14, color: confianzaColors[i], fontFace: "Calibri",
        });
        s.addText(i === 0 ? `En seguimiento: ${euro(datos.importePipeline)}` : i === 1 ? "Tendencia 6 meses" : "Proyección a 3 meses", {
          x: xCard + 0.2, y: 4.0, w: 3.65, h: 0.6,
          fontSize: 12, color: MUTED, fontFace: "Calibri", wrap: true,
        });
      });
      s.addText("* La confianza decrece con la distancia temporal. Actualizar mensualmente con los datos reales.", {
        x: 0.4, y: 6.3, w: 12.5, h: 0.4,
        fontSize: 11, color: MUTED, italic: true, fontFace: "Calibri",
      });
    }

    // ── S9 — Plan de acción ───────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: PURPLE_LIGHT };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
      s.addText("Plan de acción", {
        x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri",
      });
      const planText = parrafos[parrafos.length - 1] ?? "";
      const actions = planText.split(/(?=\d+\. )/).filter(Boolean);
      const items = actions.length >= 2 ? actions.slice(0, 3) : planText.split(/[.!]/).filter((s) => s.trim().length > 20).slice(0, 3);
      items.forEach((a, i) => {
        const xCol = 0.35 + i * 4.35;
        // Círculo numerado
        s.addShape(pptx.ShapeType.ellipse, {
          x: xCol + 1.5, y: 1.0, w: 0.85, h: 0.85, fill: { color: PRIMARY },
        });
        s.addText(String(i + 1), {
          x: xCol + 1.5, y: 1.0, w: 0.85, h: 0.85,
          fontSize: 22, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: "Calibri",
        });
        // Card
        s.addShape(pptx.ShapeType.rect, {
          x: xCol, y: 1.95, w: 4.1, h: 4.45,
          fill: { color: WHITE }, line: { color: "DDD6FE", width: 1.5 },
        });
        s.addText(a.trim().slice(0, 220), {
          x: xCol + 0.18, y: 2.15, w: 3.75, h: 4.05,
          fontSize: 13, color: DARK, fontFace: "Calibri", wrap: true, valign: "top",
        });
      });
    }

    // ── S10 — Cierre ──────────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: BG_DARK };
      s.addShape(pptx.ShapeType.rect, {
        x: 4.67, y: 3.0, w: 4.0, h: 0.07, fill: { color: PRIMARY },
      });
      s.addText("¿Preguntas?", {
        x: 1, y: 1.5, w: 11.33, h: 1.8,
        fontSize: 52, bold: true, color: WHITE, align: "center", fontFace: "Calibri",
      });
      s.addText(`${clinicaName} · ${labelCaps}`, {
        x: 1, y: 3.55, w: 11.33, h: 0.65,
        fontSize: 22, color: "A5B4FC", align: "center", fontFace: "Calibri",
      });
      s.addText("Informe generado con Fyllio CRM · Confidencial", {
        x: 1, y: 4.85, w: 11.33, h: 0.45,
        fontSize: 13, color: "4B5563", align: "center", fontFace: "Calibri",
      });
    }

    // Render
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
    console.error("[generar-ppt] error:", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
