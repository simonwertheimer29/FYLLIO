// app/(authed)/actuar-hoy/page.tsx
// Sprint 8 D.2 — "Actuar hoy" es la cola priorizada por IA (antes tab
// "Intervención" de Presupuestos). Se expone como ruta top-level.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { ActuarHoyView } from "./ActuarHoyView";

export const dynamic = "force-dynamic";

export default async function ActuarHoyPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <ActuarHoyView user={user} />;
}
