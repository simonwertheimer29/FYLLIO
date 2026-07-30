// app/lib/presupuestos/colors.ts
import type { PresupuestoEstado, EspecialidadDoctor, OrigenLead, EstadoVisual } from "./types";
import type { StatePillVariant } from "../../components/ui/StatePill";

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

// El contador de cada columna del tablero, con el mismo vocabulario de cinco
// variantes. Aquí había amber/orange/emerald/rose escritos a mano en el propio
// componente — y `orange` es un SEXTO color sin token en el sistema.
export const ESTADO_VARIANTE: Record<PresupuestoEstado, StatePillVariant> = {
  PRESENTADO: "neutral",     // recién presentado: aún no hay señal
  INTERESADO: "info",
  EN_DUDA: "warning",
  EN_NEGOCIACION: "warning", // misma familia que "en duda": abierto y caliente
  ACEPTADO: "success",
  PERDIDO: "danger",
};

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

export const ORIGEN_LABEL: Record<OrigenLead, string> = {
  google_ads:         "Google Ads",
  seo_organico:       "Google orgánico",
  referido_paciente:  "Referido",
  redes_sociales:     "Redes sociales",
  walk_in:            "Visita directa",
  otro:               "Otro",
};

// ─── Vista Máxima ────────────────────────────────────────────────────────────

// Cada estado de seguimiento se pinta con una de las CINCO variantes
// funcionales de StatePill, no con un color propio.
//
// Aquí vivían NUEVE colores escritos a mano en hex —incluidos `#8b5cf6` violeta
// y `#6d28d9` púrpura— más su `badgeClass` y un `bgClass` que teñía la fila
// entera. `StatePill` se creó justo para esto: su cabecera dice literalmente que
// "reemplaza la dispersión morado/celeste/amarillo/rosa/naranja que había por
// todo el producto", y este archivo era el último sitio donde sobrevivían los
// cinco. El violeta, además, es color retirado del producto (estándar §1).
//
// El fondo por fila desaparece: nueve tintes de fila sobre una tabla de diez
// columnas es ruido, y el estado ya se lee en su badge.
export const ESTADO_VISUAL_VARIANTE: Record<EstadoVisual, StatePillVariant> = {
  "Inicial":               "info",     // aún no se ha hecho nada: informativo
  "Primer contacto":       "warning",  // en curso, esperando
  "Segundo contacto":      "warning",
  "Necesita intervención": "danger",   // lo que urge
  "Acepta sin pagar":      "warning",  // dijo sí y falta el dinero
  "Con cita sin pagar":    "warning",
  "Tratamiento iniciado":  "success",
  "Cerrado ganado":        "success",
  "Cerrado perdido":       "neutral",  // cerrado y frío: no compite por atención
};


