// app/(authed)/red/page.tsx
// Sprint 8 Bloque D — placeholder admin-only. Contenido en D.3.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RedPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.rol !== "admin") redirect("/actuar-hoy");

  return (
    <div className="flex-1 min-h-0 p-6 overflow-auto">
      <h1 className="text-xl font-extrabold text-slate-900">Red</h1>
      <p className="text-sm text-slate-500 mt-2">
        Dashboard macro: Leads + Presupuestos + Pacientes por clínica. Se conecta en D.3.
      </p>
    </div>
  );
}
