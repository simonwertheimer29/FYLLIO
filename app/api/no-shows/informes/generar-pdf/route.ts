// app/api/no-shows/informes/generar-pdf/route.ts
// POST: genera un informe HTML descargable (abrir en browser → Ctrl+P → PDF)
// Body: { titulo, periodo, textoNarrativo?, metricas }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { titulo, periodo, textoNarrativo, metricas } = await req.json();

    const tasa     = metricas?.tasa     ?? 0;
    const total    = metricas?.totalCitas ?? 0;
    const noShows  = metricas?.totalNoShows ?? 0;
    const alertas: string[] = metricas?.alertas ?? [];

    const tasaPct  = (tasa * 100).toFixed(1);
    const today    = new Date().toLocaleDateString("es-ES", {
      day: "2-digit", month: "long", year: "numeric",
    });

    const chipColor = tasa >= 0.10 ? "#fecaca" : tasa >= 0.07 ? "#fef3c7" : "#bbf7d0";
    const chipText  = tasa >= 0.10 ? "#b91c1c" : tasa >= 0.07 ? "#92400e" : "#15803d";

    const alertasHtml = alertas.length > 0
      ? `<div class="alerts">
          <p class="alerts-title">Alertas</p>
          ${alertas.map((a) => `<div class="alert">⚠ ${a}</div>`).join("")}
        </div>`
      : "";

    const narrativeHtml = textoNarrativo
      ? `<div class="narrative">${textoNarrativo
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br/>")}</div>`
      : `<p class="no-narrative">Sin narrativo disponible.</p>`;

    const porClinicaHtml = metricas?.porClinica?.length
      ? `<div class="by-clinic">
          <p class="section-label">Por clínica</p>
          ${(metricas.porClinica as { clinica: string; tasa: number }[])
            .map(
              (c) => `<div class="clinic-row">
                <span>${c.clinica}</span>
                <span class="clinic-tasa">${(c.tasa * 100).toFixed(1)}%</span>
              </div>`
            )
            .join("")}
        </div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titulo ?? "Informe no-shows"}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 680px; margin: 48px auto; padding: 0 24px;
      color: #1e293b; line-height: 1.5;
    }
    .logo { font-size: 0.75rem; font-weight: 700; color: #06b6d4; letter-spacing: 0.1em; margin-bottom: 1.5rem; }
    h1 { font-size: 1.4rem; font-weight: 800; margin: 0 0 0.25rem; }
    .subtitle { font-size: 0.8rem; color: #64748b; margin: 0 0 1.5rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 1.5rem; }
    .chip { padding: 3px 12px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; }
    .chip-default { background: #f1f5f9; color: #334155; }
    .chip-tasa { background: ${chipColor}; color: ${chipText}; }
    .section-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin: 0 0 0.75rem; }
    .narrative { font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 1.5rem; }
    .no-narrative { font-size: 0.82rem; color: #94a3b8; font-style: italic; }
    .alerts { margin-bottom: 1.5rem; }
    .alerts-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #b91c1c; margin: 0 0 0.5rem; }
    .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; margin-bottom: 6px; font-size: 0.8rem; color: #b91c1c; }
    .by-clinic { margin-bottom: 1.5rem; }
    .clinic-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.82rem; }
    .clinic-tasa { font-weight: 700; }
    .footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; }
    @media print {
      body { margin: 24px; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="logo">FYLLIO</div>
  <h1>${titulo ?? "Informe de No-shows"}</h1>
  <p class="subtitle">${periodo ?? ""} · Generado el ${today}</p>

  <div class="chips">
    <span class="chip chip-default">${total} citas</span>
    <span class="chip chip-default">${noShows} no-shows</span>
    <span class="chip chip-tasa">${tasaPct}% tasa</span>
    ${alertas.length > 0 ? `<span class="chip" style="background:#fee2e2;color:#b91c1c">${alertas.length} alerta${alertas.length !== 1 ? "s" : ""}</span>` : ""}
  </div>

  <p class="section-label">Análisis semanal</p>
  ${narrativeHtml}
  ${alertasHtml}
  ${porClinicaHtml}

  <div class="footer">
    <span>Fyllio — Gestión inteligente de no-shows</span>
    <span>${today}</span>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type":        "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="informe-${(periodo ?? "").replace(/[^a-z0-9-]/gi, "_")}.html"`,
      },
    });
  } catch (e: any) {
    console.error("[informes/generar-pdf] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
