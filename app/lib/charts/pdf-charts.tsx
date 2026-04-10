// app/lib/charts/pdf-charts.tsx
// Gráficos nativos para @react-pdf/renderer — sin sharp, sin resvg-js
// Usa elementos SVG propios de react-pdf que se renderizan con Helvetica embebida en el PDF

import React from "react";
import { Svg, Rect, Text as PdfText } from "@react-pdf/renderer";

// ─── SVG Text con tipo extendido ─────────────────────────────────────────────
// Los tipos de @react-pdf/renderer no incluyen fontSize/fontFamily en SVGTextProps
// pero el renderer sí los procesa — usamos una aserción de tipo de componente

type SvgTextProps = {
  x?: number | string;
  y?: number | string;
  textAnchor?: "start" | "middle" | "end";
  fill?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: "bold" | "normal";
  children?: React.ReactNode;
};

const SvgText = PdfText as unknown as React.FC<SvgTextProps>;

// ─── Paleta ────────────────────────────────────────────────────────────────────

const C = {
  morado:    "#7C3AED",
  grisTexto: "#374151",
};

// ─── PdfBarrasH ───────────────────────────────────────────────────────────────
// Gráfico de barras horizontales — mismo aspecto visual que graficoBarrasH()
// pero renderizado como vectores PDF, sin PNG y sin dependencias de fuentes del sistema

export type PdfBarrasDato = {
  label: string;
  value: number;
  color?: string;
};

export interface PdfBarrasHProps {
  datos: PdfBarrasDato[];
  /** Ancho en puntos PDF. Default 499 ≈ ancho útil de A4 con padding 48pt */
  width?: number;
  /** Alto en puntos PDF */
  height?: number;
  /** Función para formatear el valor mostrado al final de cada barra */
  formatValue?: (v: number) => string;
}

export function PdfBarrasH({
  datos,
  width = 499,
  height = 160,
  formatValue = (v) => String(v),
}: PdfBarrasHProps) {
  if (!datos || datos.length === 0) return null;

  const sorted = [...datos].sort((a, b) => b.value - a.value).slice(0, 8);
  const n = sorted.length;

  // Padding interno
  const padL = 132; // espacio para labels izquierda
  const padR = 64;  // espacio para valores derecha
  const padT = 6;
  const padB = 6;

  const W = width - padL - padR;
  const H = height - padT - padB;
  const maxVal = Math.max(...sorted.map((d) => d.value), 1);

  // Altura de barra y separación entre barras
  const gap = H / n;
  const barH = Math.min(22, Math.max(10, gap * 0.55));

  return (
    <Svg width={width} height={height}>
      {sorted.map((d, i) => {
        const y = padT + i * gap + (gap - barH) / 2;
        // Mínimo de 2pt para que barras con valor muy bajo sean visibles
        const bW = Math.max((d.value / maxVal) * W, 2);
        const color = d.color ?? C.morado;
        const labelTrunc =
          d.label.length > 24 ? d.label.slice(0, 22) + "…" : d.label;

        return (
          <React.Fragment key={i}>
            {/* Label eje izquierdo */}
            <SvgText
              x={padL - 6}
              y={y + barH / 2 + 3}
              textAnchor="end"
              fontSize={8}
              fill={C.grisTexto}
              fontFamily="Helvetica"
            >
              {labelTrunc}
            </SvgText>

            {/* Barra */}
            <Rect
              x={padL}
              y={y}
              width={bW}
              height={barH}
              rx={2}
              fill={color}
              fillOpacity={0.85}
            />

            {/* Valor al final de la barra */}
            <SvgText
              x={padL + bW + 5}
              y={y + barH / 2 + 3}
              fontSize={8}
              fontFamily="Helvetica-Bold"
              fill={color}
            >
              {formatValue(d.value)}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
