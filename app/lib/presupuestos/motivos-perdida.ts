// F7 — el vocabulario de motivos de pérdida, COMPARTIDO: lo usan el modal de
// cierre (escritor único humano) y la tabla de /tablas/presupuestos (donde
// se audita el resultado). Un solo sitio para las etiquetas.

import type { MotivoPerdida } from "./types";

export const MOTIVOS_PERDIDA: { valor: MotivoPerdida; label: string }[] = [
  { valor: "precio_alto",           label: "Precio alto" },
  { valor: "otra_clinica",          label: "Eligió otra clínica" },
  { valor: "sin_urgencia",          label: "Sin urgencia percibida" },
  { valor: "necesita_financiacion", label: "Necesita financiación" },
  { valor: "miedo_tratamiento",     label: "Miedo al tratamiento" },
  { valor: "no_responde",           label: "No responde tras múltiples intentos" },
  { valor: "otro",                  label: "Otro (especificar)" },
];

export function labelMotivoPerdida(v: string | null | undefined): string {
  if (!v) return "—";
  return MOTIVOS_PERDIDA.find((m) => m.valor === v)?.label ?? v;
}
