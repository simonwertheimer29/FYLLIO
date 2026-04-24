// app/(authed)/automatizaciones/page.tsx
// Sprint 8 D.5 — vista top-level de Automatizaciones.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { AutomatizacionesTopView } from "./AutomatizacionesTopView";

export const dynamic = "force-dynamic";

export default async function AutomatizacionesPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <AutomatizacionesTopView user={user} isAdmin={s.rol === "admin"} />;
}
