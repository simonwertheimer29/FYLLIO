// app/(authed)/seguimiento/page.tsx
// P2 (18-08): la vista de las tres cohortes se alimenta sola de
// /api/seguimiento/cola — la page ya no precarga leads ni doctores (eso era
// de las pestañas viejas). Los deep-links ?vista=&cohorte= del dashboard de
// Red apuntan al vocabulario viejo y se remapean en P4.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { SeguimientoView } from "./SeguimientoView";

export const dynamic = "force-dynamic";

export default async function SeguimientoPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <SeguimientoView />;
}
