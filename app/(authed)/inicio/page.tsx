// app/(authed)/inicio/page.tsx
// F1 (fase F, 23-08): era /red, admin-only. Ahora INICIO — el dashboard
// general y la vista de entrada de TODOS (el API ya filtra por las clínicas
// de la sesión, fail-closed): coordinación ve su clínica, admin la red.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { RedView } from "./RedView";

export const dynamic = "force-dynamic";

export default async function RedPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: "manager_general",
    clinica: null,
  };

  return <RedView user={user} />;
}
