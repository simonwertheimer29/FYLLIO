// app/(authed)/pipeline/presupuestos/page.tsx
// F4b (fase F): aquí vive SOLO el kanban (Pipeline = el trabajo vivo). La
// tabla completa —la base consultable donde se audita— está en
// /tablas/presupuestos; los links viejos ?vista=maxima redirigen allí
// conservando el resto de params (?doctor= filtra la tabla).

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import PresupuestosShell from "../../../components/presupuestos/PresupuestosShell";
import type { UserSession } from "../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const v = params.vista;
  if ((Array.isArray(v) ? v[0] : v) === "maxima") {
    const q = new URLSearchParams();
    for (const [k, val0] of Object.entries(params)) {
      if (k === "vista") continue;
      const val = Array.isArray(val0) ? val0[0] : val0;
      if (val != null) q.set(k, val);
    }
    const qs = q.toString();
    redirect(`/tablas/presupuestos${qs ? `?${qs}` : ""}`);
  }

  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <PresupuestosShell user={user} vistaFija="kanban" />;
}
