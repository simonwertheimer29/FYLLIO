// app/(authed)/presupuestos/paciente/[nombre]/page.tsx
// Server Component — vista 360° del paciente. Usa sesión global.

import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth/session";
import Paciente360View from "../../../../components/presupuestos/Paciente360View";
import type { UserSession } from "../../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

export default async function PacientePage({
  params,
}: {
  params: Promise<{ nombre: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  const { nombre } = await params;
  const decoded = decodeURIComponent(nombre);

  return <Paciente360View user={user} nombre={decoded} />;
}
