// app/lib/charts/generar.ts
// Generación de gráficos server-side con chartjs-node-canvas
// Todas las funciones devuelven base64 string (PNG) o "" en caso de error

import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";

// Instancias a nivel de módulo para evitar reinicialización por llamada
const C600x300 = new ChartJSNodeCanvas({ width: 600, height: 300, backgroundColour: "white" });
const C600x280 = new ChartJSNodeCanvas({ width: 600, height: 280, backgroundColour: "white" });
const C580x240 = new ChartJSNodeCanvas({ width: 580, height: 240, backgroundColour: "white" });

export type TendenciaMes = {
  mes: string;   // "YYYY-MM"
  label: string; // "Ene", "Feb", ...
  total: number;
  aceptados: number;
};

const ANIM_OFF = { duration: 0 } as const;

// ─── Gráfico de líneas — evolución 12 meses ───────────────────────────────────
export async function graficoLineas(
  tendencia: TendenciaMes[],
  mesActual: string
): Promise<string> {
  if (!tendencia || tendencia.length === 0) return "";
  try {
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
            tension: 0.3,
            fill: true,
            borderWidth: 2.5,
            pointRadius: totales.map((_, i) => (i === mesActualIdx ? 7 : 4)),
            pointBackgroundColor: totales.map((_, i) =>
              i === mesActualIdx ? "#1D4ED8" : "#3B82F6"
            ),
          },
          {
            label: "Aceptados",
            data: aceptados,
            borderColor: "#16A34A",
            backgroundColor: "rgba(22,163,74,0.08)",
            tension: 0.3,
            fill: true,
            borderWidth: 2.5,
            pointRadius: aceptados.map((_, i) => (i === mesActualIdx ? 7 : 4)),
            pointBackgroundColor: aceptados.map((_, i) =>
              i === mesActualIdx ? "#15803D" : "#16A34A"
            ),
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        plugins: {
          legend: { position: "top", labels: { font: { size: 12 }, padding: 16 } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await C600x300.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoLineas] error:", err);
    return "";
  }
}

// ─── Gráfico de barras horizontales ──────────────────────────────────────────
export async function graficoBarsHorizontal(
  items: { label: string; value: number }[],
  color = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, 8);
    const h = Math.max(240, 50 + sorted.length * 38);
    const canvas = new ChartJSNodeCanvas({ width: 580, height: h, backgroundColour: "white" });

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: sorted.map((i) => i.label),
        datasets: [
          {
            data: sorted.map((i) => i.value),
            backgroundColor: color + "CC",
            borderColor: color,
            borderWidth: 1.5,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await canvas.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoBarsHorizontal] error:", err);
    return "";
  }
}

// ─── Gráfico de barras verticales ─────────────────────────────────────────────
export async function graficoBarsVertical(
  items: { label: string; total: number; aceptados?: number }[],
  colorTotal = "#94A3B8",
  colorAcept = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
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
              const colors = ["#7C3AED", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#94A3B8"];
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
        animation: ANIM_OFF,
        plugins: {
          legend: { display: hasAcept, labels: { font: { size: 11 } } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        },
      },
    };

    const buf = await C600x280.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoBarsVertical] error:", err);
    return "";
  }
}

// ─── Barras horizontales color-coded por clínica (verde/rojo vs media) ────────
export async function graficoClinicasBars(
  items: { label: string; tasa: number }[],
  mediaRed: number
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const sorted = [...items].sort((a, b) => b.tasa - a.tasa);
    const h = Math.max(200, 60 + sorted.length * 50);
    const canvas = new ChartJSNodeCanvas({ width: 580, height: h, backgroundColour: "white" });

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: sorted.map((i) => i.label),
        datasets: [
          {
            label: "Tasa conversión %",
            data: sorted.map((i) => i.tasa),
            backgroundColor: sorted.map((i) =>
              i.tasa >= mediaRed ? "rgba(22,163,74,0.72)" : "rgba(220,38,38,0.72)"
            ),
            borderColor: sorted.map((i) =>
              i.tasa >= mediaRed ? "#16A34A" : "#DC2626"
            ),
            borderWidth: 1.5,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => v + "%", font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await canvas.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoClinicasBars] error:", err);
    return "";
  }
}

// ─── Barras verticales de doctores + línea de media ───────────────────────────
export async function graficoDoctoresConMedia(
  doctores: { label: string; tasa: number; total: number }[],
  mediaRed: number
): Promise<string> {
  if (!doctores || doctores.length === 0) return "";
  try {
    const filtered = doctores.filter((d) => d.total >= 1).slice(0, 8);

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: filtered.map((d) =>
          d.label.length > 12 ? d.label.slice(0, 10) + "…" : d.label
        ),
        datasets: [
          {
            type: "bar" as const,
            label: "Tasa %",
            data: filtered.map((d) => d.tasa),
            backgroundColor: filtered.map((d) => {
              if (d.total < 3) return "rgba(148,163,184,0.5)";
              if (d.tasa === 0) return "rgba(220,38,38,0.72)";
              if (d.tasa >= mediaRed) return "rgba(22,163,74,0.72)";
              return "rgba(234,179,8,0.72)";
            }),
            borderRadius: 4,
          },
          {
            type: "line" as const,
            label: `Media red (${mediaRed}%)`,
            data: filtered.map(() => mediaRed),
            borderColor: "#7C3AED",
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        plugins: {
          legend: { position: "top", labels: { font: { size: 11 } } },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => v + "%", font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        },
      },
    };

    const buf = await C600x280.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoDoctoresConMedia] error:", err);
    return "";
  }
}

// ─── 3 barras de forecasting con colores de confianza ─────────────────────────
export async function graficoForecast(
  items: { mes: string; valor: number }[]
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const colors = ["rgba(22,163,74,0.8)", "rgba(234,179,8,0.75)", "rgba(148,163,184,0.65)"];

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: items.map((i) => i.mes),
        datasets: [
          {
            label: "€ proyectado",
            data: items.map((i) => i.valor),
            backgroundColor: items.map((_, i) => colors[i] ?? "rgba(148,163,184,0.6)"),
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => "€" + Number(v).toLocaleString("es-ES"),
              font: { size: 10 },
            },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    };

    const buf = await C580x240.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoForecast] error:", err);
    return "";
  }
}

// ─── Barras horizontales tricolor para A/B tonos ──────────────────────────────
export async function graficoAB(
  items: { label: string; tasa: number }[]
): Promise<string> {
  if (!items || items.length === 0) return "";
  try {
    const sorted = [...items].sort((a, b) => b.tasa - a.tasa);
    const bgColors = ["rgba(22,163,74,0.75)", "rgba(234,179,8,0.75)", "rgba(239,68,68,0.65)"];

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels: sorted.map((i) => i.label),
        datasets: [
          {
            label: "Tasa %",
            data: sorted.map((i) => i.tasa),
            backgroundColor: sorted.map((_, i) => bgColors[i] ?? "rgba(148,163,184,0.6)"),
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: ANIM_OFF,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            max: 70,
            ticks: { callback: (v) => v + "%", font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.06)" },
          },
          y: { ticks: { font: { size: 12 } }, grid: { display: false } },
        },
      },
    };

    const buf = await C580x240.renderToBuffer(config);
    return buf.toString("base64");
  } catch (err) {
    console.error("[graficoAB] error:", err);
    return "";
  }
}
