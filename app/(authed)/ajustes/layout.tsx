// app/(authed)/ajustes/layout.tsx
// Sprint 7 Fase 6 — layout de la sección Ajustes.
// Acceso restringido a admin; coord se redirige a /presupuestos.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AjustesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.rol !== "admin") redirect("/presupuestos");

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <aside className="hidden md:block w-56 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
          Ajustes
        </h2>
        <nav className="space-y-1">
          <Link
            href="/ajustes/clinica-equipo"
            className="block text-sm font-semibold rounded-lg px-3 py-2 text-slate-800 hover:bg-slate-100"
          >
            Clínica y equipo
          </Link>
          {/* Siguientes secciones se añaden aquí (Automatizaciones, etc.) */}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
