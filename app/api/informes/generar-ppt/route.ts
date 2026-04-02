// app/api/informes/generar-ppt/route.ts
// POST — genera presentación PPT mensual usando pptxgenjs
//
// Body: { mes, clinica, informe, datos, charts }
// Misma estructura que generar-pdf

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import PptxGenJS from "pptxgenjs";

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

type DoctorKpi = { doctor: string; total: number; aceptados: number; tasa: number };
type KpiResumen = {
  total: number; aceptados: number; perdidos: number; activos: number;
  tasa: number; importeTotal: number; importePipeline: number;
  porDoctor: DoctorKpi[];
  porOrigen: { origen: string; count: number }[];
  porMotivo: { motivo: string; count: number }[];
  privados: { total: number; tasa: number };
  adeslas: { total: number; tasa: number };
};

const MES_LABEL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

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

const PRIMARY = "7C3AED";
const WHITE = "FFFFFF";
const DARK = "1e293b";
const MUTED = "64748b";
const LIGHT_BG = "F8FAFC";

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { mes, clinica, informe, datos, charts = [] }: {
      mes: string; clinica: string; informe: string; datos: KpiResumen; charts: string[];
    } = body;

    if (!mes || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const label = mesLabel(mes);
    const labelCaps = label.charAt(0).toUpperCase() + label.slice(1);
    const clinicaName = clinica ?? "Clínicas";
    const [chartLine, chartMotivos, chartOrigen, chartDoctores, chartAB] = charts;

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Fyllio CRM";
    pptx.title = `Informe ${labelCaps} — ${clinicaName}`;
    pptx.subject = "Informe mensual de presupuestos";

    // ── Slide 1 — Portada ───────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: PRIMARY };
      s.addText("INFORME MENSUAL\nDE PRESUPUESTOS", {
        x: 1, y: 2, w: 8, h: 1.8, fontSize: 36, bold: true, color: WHITE,
        align: "center", valign: "middle", charSpacing: 1,
      });
      s.addText(`${labelCaps.toUpperCase()} · ${clinicaName}`, {
        x: 1, y: 4, w: 8, h: 0.5, fontSize: 16, color: "EDE9FE", align: "center",
      });
      s.addText(`Datos de ${datos.total} presupuestos · Confidencial`, {
        x: 1, y: 4.7, w: 8, h: 0.4, fontSize: 10, color: "C4B5FD", align: "center",
      });
    }

    // ── Slide 2 — Resumen en números ────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText(`${labelCaps} en números`, {
        x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY,
      });

      const metrics = [
        { label: "Presupuestos", value: String(datos.total) },
        { label: `Aceptados (${datos.tasa}%)`, value: String(datos.aceptados) },
        { label: "€ Aceptado", value: euro(datos.importeTotal) },
        { label: "Pipeline activo", value: String(datos.activos) },
      ];
      metrics.forEach((m, i) => {
        const x = 0.3 + i * 2.4;
        s.addShape(pptx.ShapeType.rect, { x, y: 1.1, w: 2.2, h: 1.1, fill: { color: "F1F5F9" }, line: { color: "E2E8F0", width: 1 } });
        s.addText(m.value, { x, y: 1.2, w: 2.2, h: 0.5, fontSize: 18, bold: true, color: DARK, align: "center" });
        s.addText(m.label, { x, y: 1.75, w: 2.2, h: 0.3, fontSize: 8, color: MUTED, align: "center" });
      });

      // Bullets del narrativo (primeros 2 párrafos)
      const bullets = informe.split("\n\n").slice(0, 2).map(p => plainText(p.trim())).filter(Boolean);
      bullets.forEach((b, i) => {
        s.addText(`• ${b}`, {
          x: 0.4, y: 2.4 + i * 1.0, w: 9.2, h: 0.8,
          fontSize: 9.5, color: DARK, wrap: true,
        });
      });
    }

    // ── Slide 3 — Evolución 12 meses ────────────────────────────────────────
    if (chartLine) {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Tendencia — últimos 12 meses", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY });
      s.addImage({ data: `data:image/png;base64,${chartLine}`, x: 0.5, y: 1.1, w: 9, h: 4.5 });
    }

    // ── Slide 4 — Motivos de pérdida ────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Principales barreras de conversión", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY });

      if (chartMotivos) {
        s.addImage({ data: `data:image/png;base64,${chartMotivos}`, x: 0.5, y: 1.1, w: 5, h: 3.5 });
      }
      // Tabla derecha
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
          align: "left",
        },
      }))), { x: 6, y: 1.1, w: 3.5, fontSize: 9 });
    }

    // ── Slide 5 — Rendimiento de doctores ───────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("Rendimiento del equipo médico", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY });

      if (chartDoctores) {
        s.addImage({ data: `data:image/png;base64,${chartDoctores}`, x: 0.5, y: 1.1, w: 4.5, h: 3.5 });
      }

      const rows: [string, string, string, string][] = [["Doctor", "Total", "Aceptados", "Tasa"]];
      datos.porDoctor.slice(0, 6).forEach(d => {
        rows.push([d.doctor, String(d.total), String(d.aceptados), `${d.tasa}%`]);
      });
      s.addTable(rows.map((r, ri) => r.map(cell => ({
        text: cell,
        options: {
          bold: ri === 0,
          fontSize: ri === 0 ? 8 : 9,
          color: ri === 0 ? MUTED : DARK,
          fill: ri === 0 ? { color: "F1F5F9" } : { color: ri % 2 === 0 ? WHITE : "F8FAFC" },
          border: { type: "solid", pt: 0.5, color: "E2E8F0" },
          align: "left",
        },
      }))), { x: 5.3, y: 1.1, w: 4.2, fontSize: 9 });
    }

    // ── Slide 6 — Canal y A/B de tonos ──────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText("¿De dónde vienen los pacientes?", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY });

      if (chartOrigen) {
        s.addImage({ data: `data:image/png;base64,${chartOrigen}`, x: 0.5, y: 1.1, w: 4.3, h: 3.5 });
      }
      if (chartAB) {
        s.addText("A/B Motor IA", { x: 5.1, y: 1.0, w: 4.4, h: 0.4, fontSize: 13, bold: true, color: PRIMARY });
        s.addImage({ data: `data:image/png;base64,${chartAB}`, x: 5.1, y: 1.5, w: 4.4, h: 3.1 });
      }
    }

    // ── Slide 7 — Plan de acción ─────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: WHITE };
      s.addText(`Prioridades para el equipo`, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: PRIMARY });

      // Extract last paragraph as the action plan
      const paras = informe.split("\n\n").filter(Boolean);
      const planText = plainText(paras[paras.length - 1] ?? "");
      // Split by numbered list (1. 2. 3.)
      const actions = planText.split(/(?=\d\.)/).filter(Boolean);
      actions.slice(0, 3).forEach((a, i) => {
        const y = 1.3 + i * 1.5;
        s.addShape(pptx.ShapeType.ellipse, { x: 0.4, y: y - 0.05, w: 0.5, h: 0.5, fill: { color: PRIMARY } });
        s.addText(String(i + 1), { x: 0.4, y: y - 0.05, w: 0.5, h: 0.5, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle" });
        s.addText(a.trim(), { x: 1.1, y, w: 8.4, h: 1.2, fontSize: 10, color: DARK, wrap: true, valign: "top" });
      });
    }

    // ── Slide 8 — Cierre ─────────────────────────────────────────────────────
    {
      const s = pptx.addSlide();
      s.background = { color: PRIMARY };
      s.addText("¿Preguntas?", {
        x: 1, y: 2.2, w: 8, h: 1.2, fontSize: 36, bold: true, color: WHITE, align: "center",
      });
      s.addText(`${clinicaName} · ${labelCaps}`, {
        x: 1, y: 3.6, w: 8, h: 0.5, fontSize: 14, color: "EDE9FE", align: "center",
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
