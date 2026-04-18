// app/lib/presupuestos/colors.ts
import type { PresupuestoEstado, EspecialidadDoctor, OrigenLead, IntencionDetectada, UrgenciaIntervencion, IntervencionTab } from "./types";

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

// ─── Cola de Intervención ─────────────────────────────────────────────────────

export const INTENCION_SECTIONS: {
  id: string;
  titulo: string;
  icono: string;
  intenciones: IntencionDetectada[];
  color: string;
  hexAccent: string;
}[] = [
  {
    id: "acepta_pago",
    titulo: "Aceptan pero no saben cómo pagar",
    icono: "💰",
    intenciones: ["Acepta sin condiciones", "Acepta pero pregunta pago"],
    color: "bg-red-100 text-red-700",
    hexAccent: "#ef4444",
  },
  {
    id: "duda_tratamiento",
    titulo: "Tienen duda sobre el tratamiento",
    icono: "❓",
    intenciones: ["Tiene duda sobre tratamiento"],
    color: "bg-amber-100 text-amber-700",
    hexAccent: "#f59e0b",
  },
  {
    id: "pide_oferta",
    titulo: "Piden oferta o descuento",
    icono: "🏷",
    intenciones: ["Pide oferta/descuento"],
    color: "bg-orange-100 text-orange-700",
    hexAccent: "#f97316",
  },
  {
    id: "pensarlo",
    titulo: "Quieren pensarlo",
    icono: "⏳",
    intenciones: ["Quiere pensarlo"],
    color: "bg-sky-100 text-sky-700",
    hexAccent: "#0ea5e9",
  },
  {
    id: "sin_respuesta",
    titulo: "Sin respuesta / Sin clasificar",
    icono: "📭",
    intenciones: ["Rechaza", "Sin clasificar"],
    color: "bg-slate-100 text-slate-600",
    hexAccent: "#94a3b8",
  },
];

export const URGENCIA_INTERVENCION_COLOR: Record<UrgenciaIntervencion, string> = {
  "CRÍTICO": "bg-red-100 text-red-700 border-red-200",
  "ALTO":    "bg-orange-100 text-orange-700 border-orange-200",
  "MEDIO":   "bg-amber-100 text-amber-700 border-amber-200",
  "BAJO":    "bg-sky-100 text-sky-700 border-sky-200",
  "NINGUNO": "bg-slate-100 text-slate-500 border-slate-200",
};

export const INTERVENCION_TABS: {
  id: IntervencionTab;
  label: string;
  intenciones?: IntencionDetectada[];
}[] = [
  { id: "actuar",        label: "Actuar ahora" },
  { id: "cerrados",      label: "Casi cerrados",  intenciones: ["Acepta sin condiciones", "Acepta pero pregunta pago"] },
  { id: "todas",         label: "Todas" },
  { id: "pago",          label: "Pago",            intenciones: ["Acepta pero pregunta pago"] },
  { id: "dudas",         label: "Dudas trat.",     intenciones: ["Tiene duda sobre tratamiento"] },
  { id: "oferta",        label: "Oferta",          intenciones: ["Pide oferta/descuento"] },
  { id: "pensarlo",      label: "Pensarlo",        intenciones: ["Quiere pensarlo"] },
  { id: "sin_respuesta", label: "Sin respuesta",   intenciones: ["Rechaza", "Sin clasificar"] },
];
