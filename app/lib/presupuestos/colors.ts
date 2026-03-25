// app/lib/presupuestos/colors.ts
import type { PresupuestoEstado, EspecialidadDoctor } from "./types";

export const ESTADO_CONFIG: Record<
  PresupuestoEstado,
  { label: string; hex: string; textColor: string; order: number }
> = {
  BOCA_SANA:      { label: "Boca Sana",      hex: "#00B0F0", textColor: "#fff",    order: 0 },
  FINALIZADO:     { label: "Finalizado",     hex: "#00B050", textColor: "#fff",    order: 1 },
  EN_TRATAMIENTO: { label: "En Tratamiento", hex: "#FFFF00", textColor: "#1e293b", order: 2 },
  INTERESADO:     { label: "Interesado",     hex: "#FF9900", textColor: "#fff",    order: 3 },
  EN_DUDA:        { label: "En Duda",        hex: "#FF6666", textColor: "#fff",    order: 4 },
  RECHAZADO:      { label: "Rechazado",      hex: "#FF0000", textColor: "#fff",    order: 5 },
} as const;

export const PIPELINE_ORDEN: PresupuestoEstado[] = [
  "BOCA_SANA",
  "FINALIZADO",
  "EN_TRATAMIENTO",
  "INTERESADO",
  "EN_DUDA",
  "RECHAZADO",
];

export const ESPECIALIDAD_COLOR: Record<EspecialidadDoctor, string> = {
  General:        "#C6EFCE",
  Prostodoncista: "#BDD7EE",
  Implantólogo:   "#9DC3E6",
  Endodoncista:   "#E2AFCF",
  Ortodoncia:     "#D9B3E0",
} as const;

// KPI chart colors (by estado, same hex)
export const CHART_COLORS = PIPELINE_ORDEN.map((e) => ESTADO_CONFIG[e].hex);
