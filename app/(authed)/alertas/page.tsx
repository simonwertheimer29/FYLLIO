// app/(authed)/alertas/page.tsx
// Sprint 8 Bloque D — placeholder admin-only. Contenido en D.7 (funcional completo).

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AlertasPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.rol !== "admin") redirect("/actuar-hoy");

  return (
    <div className="flex-1 min-h-0 p-6 overflow-auto">
      <h1 className="text-xl font-extrabold text-slate-900">Alertas</h1>
      <p className="text-sm text-slate-500 mt-2">
        Situaciones que requieren acción por parte de coordinación. Se conecta en D.7.
      </p>
    </div>
  );
}
