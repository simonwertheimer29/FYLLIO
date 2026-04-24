// app/(authed)/presupuestos/page.tsx
// Server Component — usa la sesión global Sprint 7. El guard ya vive en
// (authed)/layout.tsx; aquí solo mapeamos la sesión global a la forma
// `UserSession` legacy que espera el Shell.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import PresupuestosShell from "../../components/presupuestos/PresupuestosShell";
import type { UserSession } from "../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

export default async function PresupuestosPage() {
  const s = await getSession();
  // El layout authed ya hace redirect si falta sesión — defensa en profundidad.
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <PresupuestosShell user={user} />;
}
