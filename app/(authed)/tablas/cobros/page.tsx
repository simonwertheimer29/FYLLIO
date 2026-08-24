// app/(authed)/tablas/cobros/page.tsx
// F4b (fase F): el registro completo de cobros — cada paciente con su
// aceptado, pagado y pendiente. La cola de actuar sigue en /cobros hasta
// que F5 la funda en Seguimiento.

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import { CobrosView } from "../../cobros/CobrosView";

export const dynamic = "force-dynamic";

export default async function TablaCobrosPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <CobrosView vistaFija="registro" />;
}
