// app/(authed)/automatizaciones/page.tsx
// Sprint 8 Bloque D — placeholder. Contenido operativo + sub-tab Reglas (admin) en D.5.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AutomatizacionesPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <div className="flex-1 min-h-0 p-6 overflow-auto">
      <h1 className="text-xl font-extrabold text-slate-900">Automatizaciones</h1>
      <p className="text-sm text-slate-500 mt-2">
        Seguimientos activos + historial reciente. Se conecta en D.5.
      </p>
    </div>
  );
}
