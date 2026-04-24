// app/(authed)/kpis/page.tsx
// Sprint 8 Bloque D — placeholder. Sub-tabs Presupuestos/Leads + Exportar en D.4.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function KpisPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <div className="flex-1 min-h-0 p-6 overflow-auto">
      <h1 className="text-xl font-extrabold text-slate-900">KPIs</h1>
      <p className="text-sm text-slate-500 mt-2">
        Dashboards de Presupuestos y Leads con botón de exportar. Se conecta en D.4.
      </p>
    </div>
  );
}
