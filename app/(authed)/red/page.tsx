// app/(authed)/red/page.tsx
// Sprint 8 D.3 — dashboard macro admin-only. Integra Leads + Presupuestos
// + Pacientes.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { RedView } from "./RedView";

export const dynamic = "force-dynamic";

export default async function RedPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.rol !== "admin") redirect("/actuar-hoy");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: "manager_general",
    clinica: null,
  };

  return <RedView user={user} />;
}
