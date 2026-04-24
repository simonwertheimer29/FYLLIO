// app/(authed)/kpis/page.tsx
// Sprint 8 D.4 — KPIs con sub-tabs Presupuestos / Leads + botón Exportar.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { KpisView } from "./KpisView";

export const dynamic = "force-dynamic";

export default async function KpisPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <KpisView user={user} isAdmin={s.rol === "admin"} />;
}
