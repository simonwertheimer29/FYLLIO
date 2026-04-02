// app/lib/charts/generar.ts
// Generación de gráficos server-side con chartjs-node-canvas
// Todas las funciones devuelven base64 string (PNG) o "" en caso de error

import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";

const W = 600;
const H_LINE = 300;
const H_BARS = 280;

function makeCanvas(w: number, h: number) {
  return new ChartJSNodeCanvas({ width: w, height: h, backgroundColour: "white" });
}

export type TendenciaMes = {
  mes: string;   // "YYYY-MM"
  label: string; // "Ene", "Feb", ...
  total: number;
  aceptados: number;
};

/** Gráfico de líneas — evolución 12 meses */
export async function graficoLineas(
  tendencia: TendenciaMes[],
  mesActual: string
): Promise<string> {
  if (!tendencia || tendencia.length === 0) return "";
  try {
    const canvas = makeCanvas(W, H_LINE);
    const labels = tendencia.map((t) => t.label);
    const totales = tendencia.map((t) => t.total);
    const aceptados = tendencia.map((t) => t.aceptados);
    const mesActualIdx = tendencia.findIndex((t) => t.mes === mesActual);

    const config: ChartConfiguration = {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Ofrecidos",
            data: totales,
            borderColor: "#3B82F6",
            backgroundColor: "rgba(59,130,246,0.08)",
            tension: 0.4,
            fill: true,
            pointRadius: totales.map((_, i) => (i === mesActualIdx ? 7 : 3)),
            pointBackgroundColor: totales.map((_, i) =>
              i === mesActualIdx ? "#1D4ED8" : "#3B82F6"
            ),
          },
          {
            label: "Aceptados",
            data: aceptados,
            borderColor: "#16A34A",
            backgroundColor: "rgba(22,163,74,0.08)",
            tension: 0.4,
            fill: true,
            pointRadius: aceptados.map((_, i) => (i === mesActualIdx ? 7 : 3)),
            pointBackgroundColor: aceptados.map((_, i) =>
              i === mesActualIdx ? "#15803D" : "#16A34A"
            ),
          },
        ],
      },
      options: {
        responsive: false,
        animation: false as never,
        plugins: {
          legend: { position: "top", labels: { font: { size: 12 } } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "#f1f5f9" },
          },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await canvas.renderToBuffer(config);
    return buf.toString("base64");
  } catch {
    return "";
  }
}

/** Gráfico de barras horizontales — motivos de pérdida, canales, etc. */
export async function graficoBarsHorizontal(
  items: { label: string; value: number }[],
  color = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, 8);
    const h = Math.max(H_BARS, 50 + sorted.length * 38);
    const canvas = makeCanvas(W, h);

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: sorted.map((i) => i.label),
        datasets: [
          {
            data: sorted.map((i) => i.value),
            backgroundColor: color + "CC",
            borderColor: color,
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false as never,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "#f1f5f9" },
          },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await canvas.renderToBuffer(config);
    return buf.toString("base64");
  } catch {
    return "";
  }
}

/** Gráfico de barras verticales — doctores, canales con dos series */
export async function graficoBarsVertical(
  items: { label: string; total: number; aceptados?: number }[],
  colorTotal = "#94A3B8",
  colorAcept = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const canvas = makeCanvas(W, H_BARS);
    const hasAcept = items.some((i) => i.aceptados != null);

    const datasets: ChartConfiguration["data"]["datasets"] = hasAcept
      ? [
          {
            label: "Total",
            data: items.map((i) => i.total),
            backgroundColor: colorTotal + "BB",
            borderRadius: 4,
          },
          {
            label: "Aceptados",
            data: items.map((i) => i.aceptados ?? 0),
            backgroundColor: colorAcept + "CC",
            borderRadius: 4,
          },
        ]
      : [
          {
            label: "Valor",
            data: items.map((i) => i.total),
            backgroundColor: items.map((_, idx) => {
              const colors = ["#7C3AED", "#8B5CF6", "#A78BFA", "#C4B5FD"];
              return colors[idx % colors.length] + "CC";
            }),
            borderRadius: 4,
          },
        ];

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: items.map((i) =>
          i.label.length > 14 ? i.label.slice(0, 12) + "…" : i.label
        ),
        datasets,
      },
      options: {
        responsive: false,
        animation: false as never,
        plugins: {
          legend: { display: hasAcept, labels: { font: { size: 11 } } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "#f1f5f9" },
          },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        },
      },
    };

    const buf = await canvas.renderToBuffer(config);
    return buf.toString("base64");
  } catch {
    return "";
  }
}
