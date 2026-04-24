// app/(authed)/actuar-hoy/page.tsx
// Sprint 8 Bloque D — placeholder. El contenido (IntervencionView) se migra en D.2.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ActuarHoyPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <div className="flex-1 min-h-0 p-6 overflow-auto">
      <h1 className="text-xl font-extrabold text-slate-900">Actuar hoy</h1>
      <p className="text-sm text-slate-500 mt-2">
        Cola priorizada por IA. Se conecta en el siguiente sub-bloque de Sprint 8.
      </p>
    </div>
  );
}
