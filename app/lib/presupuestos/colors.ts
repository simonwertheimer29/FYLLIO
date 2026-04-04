// app/lib/presupuestos/colors.ts
import type { PresupuestoEstado, EspecialidadDoctor, OrigenLead } from "./types";

export const ESTADO_CONFIG: Record<
  PresupuestoEstado,
  { label: string; hex: string; textColor: string; order: number; accionable: boolean; hint: string }
> = {
  PRESENTADO:    { label: "Presentado",     hex: "#94a3b8", textColor: "#fff",    order: 0, accionable: false, hint: "Primer contacto pendiente" },
  INTERESADO:    { label: "Interesado",     hex: "#3b82f6", textColor: "#fff",    order: 1, accionable: true,  hint: "Seguimiento estándar" },
  EN_DUDA:       { label: "En Duda",        hex: "#f59e0b", textColor: "#fff",    order: 2, accionable: true,  hint: "Resolver objeciones" },
  EN_NEGOCIACION:{ label: "En Negociación", hex: "#f97316", textColor: "#fff",    order: 3, accionable: true,  hint: "Negociar precio/condiciones" },
  ACEPTADO:      { label: "Aceptado",       hex: "#22c55e", textColor: "#fff",    order: 4, accionable: false, hint: "Presupuesto aceptado" },
  PERDIDO:       { label: "Perdido",        hex: "#ef4444", textColor: "#fff",    order: 5, accionable: false, hint: "No procede" },
} as const;

export const PIPELINE_ORDEN: PresupuestoEstado[] = [
  "PRESENTADO",
  "INTERESADO",
  "EN_DUDA",
  "EN_NEGOCIACION",
  "ACEPTADO",
  "PERDIDO",
];

export const ESTADOS_ACCIONABLES: PresupuestoEstado[] = [
  "INTERESADO",
  "EN_DUDA",
  "EN_NEGOCIACION",
];

export const ESTADOS_ACEPTADOS: PresupuestoEstado[] = ["ACEPTADO"];

export const ESPECIALIDAD_COLOR: Record<EspecialidadDoctor, string> = {
  General:        "#C6EFCE",
  Prostodoncista: "#BDD7EE",
  Implantólogo:   "#9DC3E6",
  Endodoncista:   "#E2AFCF",
  Ortodoncia:     "#D9B3E0",
} as const;

export const CHART_COLORS = PIPELINE_ORDEN.map((e) => ESTADO_CONFIG[e].hex);

export const ORIGEN_LABEL: Record<OrigenLead, string> = {
  google_ads:         "Google Ads",
  seo_organico:       "Google orgánico",
  referido_paciente:  "Referido",
  redes_sociales:     "Redes sociales",
  walk_in:            "Visita directa",
  otro:               "Otro",
};
