"use client";

// Sprint 18 Bloque 8.8 → CONGELADO (MEJORAS 109, 23-08). El panel fetcheaba
// /api/no-shows/config/[clinicaId], una ruta que YA NO EXISTE (el módulo
// no-shows quedó fail-closed en el Sprint B): 404 silencioso en cada carga —
// exactamente el fallo mudo de §9/§10. Hasta que el módulo se reactive
// (sprint-b-alcance-diferido), el panel DECLARA el estado en vez de fingir
// un formulario sobre un motor que no corre.

import { Card } from "../../../components/ui/Card";
import { AlertTriangle, ICON_STROKE } from "../../../components/icons";

export function MotorNoShowsPanel(_props: { clinicaId: string }) {
  return (
    <Card>
      <div className="flex gap-2.5 p-4">
        <AlertTriangle
          size={16}
          strokeWidth={ICON_STROKE}
          className="mt-0.5 shrink-0 text-[var(--color-warning)]"
          aria-hidden
        />
        <div>
          <p className="text-[13.5px] font-semibold text-[var(--color-foreground)]">
            El motor de no-shows está desactivado
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
            El módulo de predicción de no-shows quedó fuera de servicio al blindar el aislamiento
            entre clientes, y su configuración no tiene efecto mientras tanto. Cuando se reactive,
            este panel volverá con sus ajustes.
          </p>
        </div>
      </div>
    </Card>
  );
}
