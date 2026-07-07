"use client";

// /automatizaciones top-level — renderiza el motor de reglas.
// Las vistas legacy (AutomatizacionesView, ConfigAutomatizaciones en
// app/components/presupuestos/) se conservan en el código pero ya no se
// ofrecen como pestañas.

import type { UserSession } from "../../lib/presupuestos/types";
import { MotorReglasView } from "./MotorReglasView";

export function AutomatizacionesTopView({
  isAdmin,
}: {
  user: UserSession;
  isAdmin: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-4 lg:p-6">
      <MotorReglasView isAdmin={isAdmin} />
    </div>
  );
}
