// app/(authed)/alertas/page.tsx
// Sprint 8 D.7 — admin only. Delega a client view para polling + acciones.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { AlertasView } from "./AlertasView";

export const dynamic = "force-dynamic";

export default async function AlertasPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.rol !== "admin") redirect("/actuar-hoy");

  return <AlertasView />;
}
