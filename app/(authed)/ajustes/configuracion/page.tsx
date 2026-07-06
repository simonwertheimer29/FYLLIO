// app/(authed)/ajustes/configuracion/page.tsx
// Sprint 14b Bloque 0 — panel de configuración por clínica.
// Server component: solo carga la lista de clínicas para el selector;
// el resto vive en el client component.

import { redirect } from "next/navigation";
import { listClinicas } from "../../../lib/auth/users";
import { getSession } from "../../../lib/auth/session";
import ConfiguracionView from "./ConfiguracionView";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Fase 4 — solo las clínicas del cliente del usuario.
  const clinicas = await listClinicas({ onlyActivas: true, cliente: session.cliente });
  return <ConfiguracionView clinicas={clinicas.map((c) => ({ id: c.id, nombre: c.nombre }))} />;
}
