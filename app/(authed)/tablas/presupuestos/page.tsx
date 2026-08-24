// app/(authed)/tablas/presupuestos/page.tsx
// F4b (fase F): la tabla completa de presupuestos — TODOS, con su recorrido
// y su resultado (estado final + motivo de pérdida). El kanban del trabajo
// vivo está en /pipeline/presupuestos; mismo shell, lente fija.

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import PresupuestosShell from "../../../components/presupuestos/PresupuestosShell";
import type { UserSession } from "../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

export default async function TablaPresupuestosPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <PresupuestosShell user={user} vistaFija="maxima" />;
}
