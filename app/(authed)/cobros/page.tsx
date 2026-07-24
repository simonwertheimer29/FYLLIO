// app/(authed)/cobros/page.tsx
// Módulo Cobros (2026-07-24) — tercera etapa del flujo lead → presupuesto →
// cobro, ascendida de sub-pestaña de Pacientes a módulo propio. Los datos
// los sirve /api/cobros (client fetch, como el resto de colas).

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { CobrosView } from "./CobrosView";

export const dynamic = "force-dynamic";

export default async function CobrosPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <CobrosView />;
}
