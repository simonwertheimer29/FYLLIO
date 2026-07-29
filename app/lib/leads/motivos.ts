// Motivos por los que se descarta un lead (MEJORAS 42, 2026-07-27).
//
// Vocabulario CERRADO de seis valores: sin "otro (texto libre)" a propósito —
// el texto libre es justo lo que rompió el dato en la nº 41, y un motivo que
// nadie puede agregar no sirve para decidir nada.
//
// La partición reactivable / descartado es el criterio de negocio: ¿queda algo
// que intentar con este lead? Los reactivables vuelven a la cola cuando cambie
// la circunstancia; los descartados son una decisión tomada contra nosotros.
//
// Módulo PURO: lo consumen componentes cliente, el repo y el Copilot.

export const MOTIVOS_LEAD = [
  "No_Asistio",
  "No_Contesta",
  "Horarios",
  "Precio",
  "Otra_Clinica",
  "Ya_No_Necesita",
] as const;

export type MotivoLead = (typeof MOTIVOS_LEAD)[number];

/** Valor legacy previo al vocabulario de seis (nº 42). Se sigue leyendo. */
export const MOTIVO_LEGACY = "Rechazo_Producto";

export type MotivoLeadAlmacenado = MotivoLead | typeof MOTIVO_LEGACY;

type Def = { label: string; hint: string; reactivable: boolean };

export const MOTIVO_DEF: Record<MotivoLeadAlmacenado, Def> = {
  No_Asistio: {
    label: "No asistió",
    hint: "Tenía cita y no se presentó",
    reactivable: true,
  },
  No_Contesta: {
    label: "No contesta",
    hint: "Varios intentos sin respuesta — nunca llegó a haber conversación",
    reactivable: true,
  },
  Horarios: {
    label: "Horarios o distancia",
    hint: "Le encaja el tratamiento, no el cuándo o el dónde",
    reactivable: true,
  },
  Precio: {
    label: "Precio",
    hint: "Le parece caro o no puede permitírselo ahora",
    reactivable: false,
  },
  Otra_Clinica: {
    label: "Se fue a otra clínica",
    hint: "Lo hará con la competencia",
    reactivable: false,
  },
  Ya_No_Necesita: {
    label: "Ya no lo necesita",
    hint: "Lo resolvió por otra vía o cambió de idea",
    reactivable: false,
  },
  // Legacy: un descarte genérico anterior al vocabulario de seis.
  [MOTIVO_LEGACY]: {
    label: "No le interesa",
    hint: "Motivo registrado antes del vocabulario actual",
    reactivable: false,
  },
};

/** Etiqueta legible. Un valor desconocido se muestra tal cual, nunca revienta. */
export function labelMotivo(v: string | null | undefined): string {
  if (!v) return "sin motivo";
  return MOTIVO_DEF[v as MotivoLeadAlmacenado]?.label ?? v;
}

/** ¿Queda algo que intentar? Un valor desconocido cuenta como descartado. */
export function esReactivable(v: string | null | undefined): boolean {
  if (!v) return false;
  return MOTIVO_DEF[v as MotivoLeadAlmacenado]?.reactivable ?? false;
}

/** Orden de presentación: primero lo que aún se puede rescatar. */
export const MOTIVOS_ORDENADOS: MotivoLead[] = [...MOTIVOS_LEAD];
