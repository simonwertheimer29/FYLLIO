"use client";

import type { UserSession, PresupuestoIntervencion } from "../../lib/presupuestos/types";

export default function MaximaView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-sm font-bold text-slate-700">Vista Máxima</p>
      <p className="text-xs text-slate-400 mt-1">En construcción...</p>
    </div>
  );
}
