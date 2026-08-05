// app/components/automatizacion/QueSeDetecta.tsx
//
// Declara EN PANTALLA qué dispara el aviso y qué no. Fase 1 de PLAN-AGENTE.
//
// ─── Por qué existe ─────────────────────────────────────────────────────────
//
// De los seis disparadores universales, la clasificación que hay hoy solo produce
// tres. Si la coordinadora cree que el sistema caza quejas y no las caza, deja de
// leer los mensajes que el sistema no marcó — y entonces el producto es PEOR que
// no tener aviso ninguno, porque ha comprado su atención con una promesa falsa.
//
// Es la misma regla que retiró los scores del predictor y el "precisión 0 %": el
// producto dice lo que hace, no lo que querríamos que hiciera.
//
// Este bloque desaparece EN EL MISMO CAMBIO que haga detectables los tres que
// faltan (fase 2), ni antes ni después.

import { Info } from "../icons";
import {
  DISPARADORES_ACTIVOS,
  DISPARADORES_PENDIENTES,
  ETIQUETA_DISPARADOR,
} from "../../lib/automatizacion/estado";

export function QueSeDetecta({ dominio }: { dominio: "presupuestos" | "leads" }) {
  const activos = DISPARADORES_ACTIVOS.map((d) => ETIQUETA_DISPARADOR[d].toLowerCase());
  const pendientes = DISPARADORES_PENDIENTES.map((d) => ETIQUETA_DISPARADOR[d].toLowerCase());

  return (
    <div className="mb-3 flex gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
      <Info
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)]"
        aria-hidden
      />
      <div className="min-w-0 text-[13px] leading-relaxed text-[var(--color-muted)]">
        {dominio === "presupuestos" ? (
          <>
            El aviso salta con <span className="font-medium text-[var(--color-foreground)]">{activos.join(", ")}</span>.
            Todavía <span className="font-medium text-[var(--color-foreground)]">no</span> detecta{" "}
            {pendientes.join(", ")} — esos mensajes hay que leerlos igual.
          </>
        ) : (
          <>
            En leads el aviso todavía{" "}
            <span className="font-medium text-[var(--color-foreground)]">no lee el contenido</span> de
            los mensajes: aquí solo avisa cuando se agota el seguimiento. Los mensajes de leads hay que
            leerlos igual.
          </>
        )}
      </div>
    </div>
  );
}
