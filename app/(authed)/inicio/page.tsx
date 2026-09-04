// app/(authed)/inicio/page.tsx
// INICIO (rediseño 31-08): operativo — cada número cambia lo que alguien hace
// hoy; lo analítico vive en KPIs. El API filtra por las clínicas de la sesión
// (fail-closed): coordinación ve su clínica, dirección la red.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { InicioView } from "./InicioView";

export const dynamic = "force-dynamic";

export default async function InicioPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <InicioView />;
}
