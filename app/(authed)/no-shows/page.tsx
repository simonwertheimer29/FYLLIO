// app/(authed)/no-shows/page.tsx
// Server Component — usa la sesión global Sprint 7 y mapea a la shape
// `NoShowsUserSession` legacy que espera el Shell.

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "../../lib/auth/session";
import NoShowsShell from "../../components/no-shows/NoShowsShell";
import type { NoShowsUserSession } from "../../lib/no-shows/types";

export const dynamic = "force-dynamic";

export default async function NoShowsPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: NoShowsUserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return (
    <Suspense fallback={null}>
      <NoShowsShell user={user} />
    </Suspense>
  );
}
