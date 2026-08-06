// app/components/automatizacion/EstadoAutomatizacionPill.tsx
//
// El distintivo de "quién lleva este caso" en las tarjetas de todas las ventanas.
// Fase 1 de PLAN-AGENTE.
//
// Se construye sobre StatePill, que es el primitivo de pill del producto — no se
// crea un sistema de variantes paralelo.
//
// ─── La decisión de diseño que importa ──────────────────────────────────────
//
// `esperando` NO pinta nada. Es el residual: el 90 % de los casos están ahí, y un
// distintivo en cada tarjeta que dice "en curso" es ruido puro — la coordinadora
// deja de mirarlos todos por igual. El distintivo aparece solo cuando dice algo
// que cambia lo que hay que hacer: necesita persona, toca llamar, ya lo lleva
// alguien, o está fuera de automatización por decisión propia.

import { AlertTriangle, PhoneCall, UserCheck, Hand, ClipboardList } from "../icons";
import { StatePill, type StatePillVariant } from "../ui/StatePill";
import {
  ETIQUETA_ESTADO,
  ACCION_ESTADO,
  type EstadoAutomatizacion,
} from "../../lib/automatizacion/estado";

type Config = {
  variant: StatePillVariant;
  Icono: typeof AlertTriangle;
};

const CONFIG: Partial<Record<EstadoAutomatizacion, Config>> = {
  // Rojo: es lo único que compromete a la clínica si se responde mal.
  quebrado: { variant: "danger", Icono: AlertTriangle },
  // Ámbar: no es un error, es un cambio de canal.
  agotado: { variant: "warning", Icono: PhoneCall },
  // Neutro con borde: hay que hacer algo, pero no es urgente ni delicado —
  // es cerrar el caso y dejar escrito por qué se perdió.
  cierre_pendiente: { variant: "neutral", Icono: ClipboardList },
  // Azul de acento: informativo, no urgente.
  en_manos_de_alguien: { variant: "info", Icono: UserCheck },
  // Neutro: una decisión tomada, sin urgencia.
  manual: { variant: "neutral", Icono: Hand },
  // `esperando` y `cerrado` no aparecen a propósito — ver la nota de arriba.
};

export function EstadoAutomatizacionPill({
  estado,
  motivo,
  size = "sm",
  className = "",
}: {
  estado: EstadoAutomatizacion;
  /** Motivo legible del quiebre. Se enseña en el `title` para no alargar la
   *  tarjeta; el texto completo vive en la cola de Seguimiento. */
  motivo?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const cfg = CONFIG[estado];
  if (!cfg) return null;

  const { variant, Icono } = cfg;
  const titulo = motivo ? `${ACCION_ESTADO[estado]} — ${motivo}` : ACCION_ESTADO[estado];

  return (
    <StatePill variant={variant} size={size} title={titulo} className={className}>
      <Icono className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{ETIQUETA_ESTADO[estado]}</span>
    </StatePill>
  );
}
