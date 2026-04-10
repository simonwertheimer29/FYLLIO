// app/lib/charts/svg-charts.ts
// Generación de gráficos server-side con SVG inline + sharp (PNG output)
// Usado como fallback server-side por el PDF mensual cuando el cliente no puede capturar el DOM
// El PDF semanal usa pdf-charts.tsx (react-pdf SVG nativo) — no usa este archivo

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const sharp = require("sharp") as any;

// ─── Paleta ────────────────────────────────────────────────────────────────────

const C = {
  azul:      "#3B82F6",
  verde:     "#16A34A",
  rojo:      "#DC2626",
  naranja:   "#D97706",
  morado:    "#7C3AED",
  gris:      "#9CA3AF",
  grisBorde: "#E5E7EB",
  grisTexto: "#374151",
  grisMedio: "#6B7280",
};

// ─── Core helper ──────────────────────────────────────────────────────────────

async function svgToPng(svg: string, w: number, h: number): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(svg))
      .resize(w, h, { fit: "fill" })
      .png()
      .toBuffer();
  } catch (err) {
    console.error("[svg-charts] svgToPng error:", err);
    return null;
  }
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── 1. Gráfico de líneas — evolución 12 meses ────────────────────────────────

export async function graficoLineas(
  datos: { label: string; ofrecidos: number; aceptados: number }[],
  widthPx = 900,
  heightPx = 380
): Promise<Buffer | null> {
  if (!datos || datos.length === 0) return null;
  const pad = { top: 40, right: 30, bottom: 50, left: 50 };
  const W = widthPx - pad.left - pad.right;
  const H = heightPx - pad.top - pad.bottom;
  const n = datos.length;
  const maxVal = Math.max(...datos.map((d) => d.ofrecidos), 1) * 1.15;
  const step = n > 1 ? W / (n - 1) : W;

  const xs = datos.map((_, i) => pad.left + i * step);
  const yOf = datos.map((d) => pad.top + H - (d.ofrecidos / maxVal) * H);
  const yAc = datos.map((d) => pad.top + H - (d.aceptados / maxVal) * H);

  const ptsOf = xs.map((x, i) => `${x.toFixed(1)},${yOf[i].toFixed(1)}`).join(" ");
  const ptsAc = xs.map((x, i) => `${x.toFixed(1)},${yAc[i].toFixed(1)}`).join(" ");

  const areaOf = `${pad.left},${pad.top + H} ${ptsOf} ${pad.left + W},${pad.top + H}`;
  const areaAc = `${pad.left},${pad.top + H} ${ptsAc} ${pad.left + W},${pad.top + H}`;

  const gridLines = Array.from({ length: 6 }, (_, i) => {
    const val = Math.round((maxVal / 5) * i);
    const y = (pad.top + H - (val / maxVal) * H).toFixed(1);
    return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + W}" y2="${y}" stroke="${C.grisBorde}" stroke-width="1"/>
<text x="${pad.left - 8}" y="${parseFloat(y) + 4}" text-anchor="end" font-size="11" fill="${C.grisMedio}">${val}</text>`;
  }).join("\n");

  const labelsX = datos.map((d, i) =>
    `<text x="${xs[i].toFixed(1)}" y="${pad.top + H + 20}" text-anchor="middle" font-size="11" fill="${C.grisTexto}">${esc(d.label)}</text>`
  ).join("\n");

  const circlesOf = xs.map((x, i) =>
    `<circle cx="${x.toFixed(1)}" cy="${yOf[i].toFixed(1)}" r="${i === n - 1 ? 7 : 4}" fill="${C.azul}" stroke="white" stroke-width="2"/>`
  ).join("\n");
  const circlesAc = xs.map((x, i) =>
    `<circle cx="${x.toFixed(1)}" cy="${yAc[i].toFixed(1)}" r="${i === n - 1 ? 7 : 4}" fill="${C.verde}" stroke="white" stroke-width="2"/>`
  ).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" style="background:white">
  <rect width="${widthPx}" height="${heightPx}" fill="white"/>
  <rect x="${pad.left}" y="10" width="12" height="12" rx="2" fill="${C.azul}"/>
  <text x="${pad.left + 16}" y="21" font-size="12" fill="${C.grisTexto}">Ofrecidos</text>
  <rect x="${pad.left + 95}" y="10" width="12" height="12" rx="2" fill="${C.verde}"/>
  <text x="${pad.left + 111}" y="21" font-size="12" fill="${C.grisTexto}">Aceptados</text>
  ${gridLines}
  <polygon points="${areaOf}" fill="${C.azul}" opacity="0.07"/>
  <polygon points="${areaAc}" fill="${C.verde}" opacity="0.09"/>
  <polyline points="${ptsOf}" fill="none" stroke="${C.azul}" stroke-width="2.5" stroke-linejoin="round"/>
  <polyline points="${ptsAc}" fill="none" stroke="${C.verde}" stroke-width="2.5" stroke-linejoin="round"/>
  ${circlesOf}
  ${circlesAc}
  <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + H}" stroke="${C.grisBorde}" stroke-width="1"/>
  <line x1="${pad.left}" y1="${pad.top + H}" x2="${pad.left + W}" y2="${pad.top + H}" stroke="${C.grisBorde}" stroke-width="1"/>
  ${labelsX}
</svg>`;

  return svgToPng(svg, widthPx, heightPx);
}

// ─── 2. Barras horizontales ────────────────────────────────────────────────────

export async function graficoBarrasH(
  datos: { label: string; value: number; color?: string }[],
  widthPx = 860,
  heightPx = 300
): Promise<Buffer | null> {
  if (!datos || datos.length === 0) return null;
  const sorted = [...datos].sort((a, b) => b.value - a.value).slice(0, 8);
  const n = sorted.length;
  const padL = 160;
  const padR = 80;
  const padT = 20;
  const padB = 20;
  const W = widthPx - padL - padR;
  const H = heightPx - padT - padB;
  const maxVal = Math.max(...sorted.map((d) => d.value), 1);
  const barH = Math.min(38, (H / n) * 0.6);
  const gap = H / n;

  const barras = sorted.map((d, i) => {
    const y = padT + i * gap + (gap - barH) / 2;
    const bW = (d.value / maxVal) * W;
    const color = d.color ?? C.morado;
    const labelTrunc = d.label.length > 22 ? d.label.slice(0, 20) + "…" : d.label;
    return `
<text x="${padL - 10}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${C.grisTexto}">${esc(labelTrunc)}</text>
<rect x="${padL}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="${color}" opacity="0.85"/>
<text x="${(padL + bW + 8).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="12" font-weight="bold" fill="${color}">${d.value}</text>`;
  }).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" style="background:white">
  <rect width="${widthPx}" height="${heightPx}" fill="white"/>
  ${barras}
</svg>`;

  return svgToPng(svg, widthPx, heightPx);
}

// ─── 3. Barras verticales con línea de media ──────────────────────────────────

export async function graficoBarrasV(
  datos: { label: string; value: number; color?: string }[],
  mediaRed: number,
  widthPx = 900,
  heightPx = 360
): Promise<Buffer | null> {
  if (!datos || datos.length === 0) return null;
  const n = datos.length;
  const padL = 55;
  const padR = 70;
  const padT = 50;
  const padB = 65;
  const W = widthPx - padL - padR;
  const H = heightPx - padT - padB;
  const maxVal = Math.max(...datos.map((d) => d.value), mediaRed, 1) * 1.2;
  const barW = Math.min(60, (W / n) * 0.55);
  const gap = W / n;

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round((maxVal / 4) * i);
    const y = (padT + H - (val / maxVal) * H).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${padL + W}" y2="${y}" stroke="${C.grisBorde}" stroke-width="1"/>
<text x="${padL - 8}" y="${parseFloat(y) + 4}" text-anchor="end" font-size="11" fill="${C.grisMedio}">${val}%</text>`;
  }).join("\n");

  const barras = datos.map((d, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const bH = (d.value / maxVal) * H;
    const y = padT + H - bH;
    const color = d.color ?? (d.value === 0 ? C.rojo : d.value >= mediaRed ? C.verde : C.naranja);
    const parts = d.label.split(" ");
    const line1 = parts[0] ?? "";
    const line2 = parts.slice(1).join(" ");
    return `
<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" rx="3" fill="${color}"/>
${d.value > 0 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="bold" fill="${color}">${d.value}%</text>` : ""}
<text x="${(x + barW / 2).toFixed(1)}" y="${(padT + H + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="${C.grisTexto}">${esc(line1)}</text>
${line2 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(padT + H + 34).toFixed(1)}" text-anchor="middle" font-size="10" fill="${C.grisMedio}">${esc(line2)}</text>` : ""}`;
  }).join("\n");

  const yMedia = (padT + H - (mediaRed / maxVal) * H).toFixed(1);
  const lineaMedia = `
<line x1="${padL}" y1="${yMedia}" x2="${padL + W}" y2="${yMedia}" stroke="${C.morado}" stroke-width="2.5" stroke-dasharray="6,4"/>
<text x="${padL + W + 6}" y="${parseFloat(yMedia) + 5}" font-size="11" fill="${C.morado}">Media ${mediaRed}%</text>`;

  const leyenda = `
<circle cx="${padL + 8}" cy="22" r="6" fill="${C.verde}"/>
<text x="${padL + 18}" y="26" font-size="11" fill="${C.grisTexto}">Mayor o igual a media</text>
<circle cx="${padL + 175}" cy="22" r="6" fill="${C.naranja}"/>
<text x="${padL + 185}" y="26" font-size="11" fill="${C.grisTexto}">Bajo media</text>
<circle cx="${padL + 270}" cy="22" r="6" fill="${C.rojo}"/>
<text x="${padL + 280}" y="26" font-size="11" fill="${C.grisTexto}">0% - urgente</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" style="background:white">
  <rect width="${widthPx}" height="${heightPx}" fill="white"/>
  ${leyenda}
  ${gridLines}
  ${barras}
  ${lineaMedia}
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + H}" stroke="${C.grisBorde}" stroke-width="1"/>
  <line x1="${padL}" y1="${padT + H}" x2="${padL + W}" y2="${padT + H}" stroke="${C.grisBorde}" stroke-width="1"/>
</svg>`;

  return svgToPng(svg, widthPx, heightPx);
}

// ─── 4. Forecast — 3 barras verticales con valor encima ───────────────────────

export async function graficoForecast(
  datos: { mes: string; valor: number; color: string }[],
  widthPx = 700,
  heightPx = 300
): Promise<Buffer | null> {
  if (!datos || datos.length === 0) return null;
  const padL = 80;
  const padR = 30;
  const padT = 55;
  const padB = 50;
  const W = widthPx - padL - padR;
  const H = heightPx - padT - padB;
  const n = datos.length;
  const maxVal = Math.max(...datos.map((d) => d.valor), 1) * 1.25;
  const barW = Math.min(90, (W / n) * 0.5);
  const gap = W / n;

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round((maxVal / 4) * i);
    const y = (padT + H - (val / maxVal) * H).toFixed(1);
    const valFmt = `€${val.toLocaleString("es-ES")}`;
    return `<line x1="${padL}" y1="${y}" x2="${padL + W}" y2="${y}" stroke="${C.grisBorde}" stroke-width="1"/>
<text x="${padL - 8}" y="${parseFloat(y) + 4}" text-anchor="end" font-size="10" fill="${C.grisMedio}">${valFmt}</text>`;
  }).join("\n");

  const barras = datos.map((d, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const bH = (d.valor / maxVal) * H;
    const y = padT + H - bH;
    const valorFmt = `€${d.valor.toLocaleString("es-ES")}`;
    return `
<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" rx="4" fill="${d.color}" opacity="0.85"/>
<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="bold" fill="${d.color}">${valorFmt}</text>
<text x="${(x + barW / 2).toFixed(1)}" y="${(padT + H + 22).toFixed(1)}" text-anchor="middle" font-size="12" fill="${C.grisTexto}">${esc(d.mes)}</text>`;
  }).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" style="background:white">
  <rect width="${widthPx}" height="${heightPx}" fill="white"/>
  ${gridLines}
  ${barras}
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + H}" stroke="${C.grisBorde}" stroke-width="1"/>
  <line x1="${padL}" y1="${padT + H}" x2="${padL + W}" y2="${padT + H}" stroke="${C.grisBorde}" stroke-width="1"/>
</svg>`;

  return svgToPng(svg, widthPx, heightPx);
}

// ─── 5. A/B tonos — barras horizontales tricolor ──────────────────────────────

export async function graficoAB(
  datos: { tono: string; tasa: number; mensajes: number }[],
  widthPx = 800,
  heightPx = 260
): Promise<Buffer | null> {
  if (!datos || datos.length === 0) return null;
  const colores = [C.verde, C.naranja, C.gris];
  const sorted = [...datos].sort((a, b) => b.tasa - a.tasa);
  return graficoBarrasH(
    sorted.map((d, i) => ({
      label: `${d.tono} (${d.mensajes})`,
      value: d.tasa,
      color: colores[i] ?? C.gris,
    })),
    widthPx,
    heightPx
  );
}
