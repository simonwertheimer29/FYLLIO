// app/lib/charts/generar.ts
// Generación de gráficos server-side con @napi-rs/canvas + chart.js
// @napi-rs/canvas distribuye binarios pre-compilados para Linux/Vercel sin deps del sistema
// Todas las funciones devuelven base64 string (PNG) o "" en caso de error

import { createCanvas } from "@napi-rs/canvas";
import { Chart, registerables } from "chart.js";
import type { ChartConfiguration } from "chart.js";

// Register all Chart.js components once at module level
Chart.register(...registerables);

// Patch requestAnimationFrame for Chart.js in Node.js (no DOM available)
if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (fn: (t: number) => void) => {
    fn(Date.now());
    return 0;
  };
  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = () => {};
}

const ANIM_OFF = { duration: 0 } as const;

// ─── Core render helper ────────────────────────────────────────────────────────

async function renderChart(
  config: ChartConfiguration,
  width: number,
  height: number
): Promise<string> {
  try {
    const canvas = createCanvas(width, height);

    // White background
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart = new Chart(canvas as any, config);
    // Export BEFORE destroy — chart.destroy() clears the canvas
    const buffer = canvas.toBuffer("image/png");
    chart.destroy();
    return buffer.toString("base64");
  } catch (err) {
    console.error("[renderChart] error:", err);
    return "";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TendenciaMes = {
  mes: string;   // "YYYY-MM"
  label: string; // "Ene", "Feb", ...
  total: number;
  aceptados: number;
};

// ─── Gráfico de líneas — evolución 12 meses ───────────────────────────────────
export async function graficoLineas(
  tendencia: TendenciaMes[],
  mesActual: string
): Promise<string> {
  if (!tendencia || tendencia.length === 0) return "";
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
  return renderChart(config, 600, 300);
}

// ─── Gráfico de barras horizontales ──────────────────────────────────────────
export async function graficoBarsHorizontal(
  items: { label: string; value: number }[],
  color = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, 8);
  const h = Math.max(240, 50 + sorted.length * 38);

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
  return renderChart(config, 580, h);
}

// ─── Gráfico de barras verticales ─────────────────────────────────────────────
export async function graficoBarsVertical(
  items: { label: string; total: number; aceptados?: number }[],
  colorTotal = "#94A3B8",
  colorAcept = "#7C3AED"
): Promise<string> {
  if (!items || items.length === 0) return "";
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
  return renderChart(config, 600, 280);
}

// ─── Barras horizontales color-coded por clínica (verde/rojo vs media) ────────
export async function graficoClinicasBars(
  items: { label: string; tasa: number }[],
  mediaRed: number
): Promise<string> {
  if (!items || items.length === 0) return "";
  const sorted = [...items].sort((a, b) => b.tasa - a.tasa);
  const h = Math.max(200, 60 + sorted.length * 50);

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
      plugins: { legend: { display: false } },
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
  return renderChart(config, 580, h);
}

// ─── Barras verticales de doctores + línea de media ───────────────────────────
export async function graficoDoctoresConMedia(
  doctores: { label: string; tasa: number; total: number }[],
  mediaRed: number
): Promise<string> {
  if (!doctores || doctores.length === 0) return "";
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
  return renderChart(config, 600, 280);
}

// ─── 3 barras de forecasting con colores de confianza ─────────────────────────
export async function graficoForecast(
  items: { mes: string; valor: number }[]
): Promise<string> {
  if (!items || items.length === 0) return "";
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
  return renderChart(config, 580, 240);
}

// ─── Barras horizontales tricolor para A/B tonos ──────────────────────────────
export async function graficoAB(
  items: { label: string; tasa: number }[]
): Promise<string> {
  if (!items || items.length === 0) return "";
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
  return renderChart(config, 580, 240);
}
