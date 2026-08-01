// app/(authed)/ajustes/layout.tsx
// Sprint 7 Fase 6 — layout de la sección Ajustes.
// Acceso restringido a admin; coord se redirige a /seguimiento.
//
// La navegación vive en `AjustesNav` (cliente): necesita saber qué sección está
// activa y existir también en móvil. Aquí solo queda la puerta y el marco.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { AjustesNav } from "./AjustesNav";

export const dynamic = "force-dynamic";

export default async function AjustesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.rol !== "admin") redirect("/seguimiento");

  return (
    // En móvil la navegación va arriba en horizontal, así que la caja apila;
    // en escritorio es barra lateral + contenido.
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--color-background)] md:flex-row">
      <AjustesNav />
      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6">{children}</main>
    </div>
  );
}
