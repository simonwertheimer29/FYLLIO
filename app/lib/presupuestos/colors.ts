// app/lib/presupuestos/colors.ts
import type { PresupuestoEstado, EspecialidadDoctor, OrigenLead, UrgenciaIntervencion, IntervencionTab, EstadoVisual } from "./types";

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

// ─── Vista Máxima ────────────────────────────────────────────────────────────

export const ESTADO_VISUAL_CONFIG: Record<
  EstadoVisual,
  { hex: string; badgeClass: string; bgClass: string }
> = {
  "Inicial":                  { hex: "#3b82f6", badgeClass: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25",     bgClass: "bg-blue-50 dark:bg-blue-500/10" },
  "Primer contacto":          { hex: "#eab308", badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25", bgClass: "bg-yellow-50 dark:bg-yellow-500/10" },
  "Segundo contacto":         { hex: "#f97316", badgeClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25", bgClass: "bg-orange-50 dark:bg-orange-500/10" },
  "Necesita intervención":    { hex: "#ef4444", badgeClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25",       bgClass: "bg-red-50 dark:bg-red-500/10" },
  "Acepta sin pagar":         { hex: "#8b5cf6", badgeClass: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/25", bgClass: "bg-violet-50 dark:bg-violet-500/10" },
  "Con cita sin pagar":       { hex: "#6d28d9", badgeClass: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25", bgClass: "bg-purple-50 dark:bg-purple-500/10" },
  "Tratamiento iniciado":     { hex: "#86efac", badgeClass: "bg-green-100 text-green-600 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25",   bgClass: "bg-green-50 dark:bg-green-500/10" },
  "Cerrado ganado":           { hex: "#22c55e", badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25", bgClass: "bg-emerald-50 dark:bg-emerald-500/10" },
  "Cerrado perdido":          { hex: "#94a3b8", badgeClass: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/25",   bgClass: "bg-slate-50 dark:bg-slate-500/10" },
};

// ─── Cola de Intervención ─────────────────────────────────────────────────────

export const URGENCIA_INTERVENCION_COLOR: Record<UrgenciaIntervencion, string> = {
  "CRÍTICO": "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25",
  "ALTO":    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25",
  "MEDIO":   "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25",
  "BAJO":    "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-border)]",
  "NINGUNO": "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/25",
};

export const INTERVENCION_TABS: {
  id: IntervencionTab;
  label: string;
}[] = [
  // P3 unificación (2026-07-23): mismo modelo que Leads. "Actuar ahora" =
  // pendiente_responder + reactivable (estadoConversacion); "Esperando
  // respuesta" = en_espera_paciente. Las pills por intención IA se retiraron.
  { id: "actuar",    label: "Actuar ahora" },
  { id: "esperando", label: "Esperando respuesta" },
];
