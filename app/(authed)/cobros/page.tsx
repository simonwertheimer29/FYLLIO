// app/(authed)/cobros/page.tsx
// F4b (fase F): aquí queda SOLO la cola de cobros (Actuar) — hasta que F5
// la funda en las cohortes de Seguimiento. El Registro (la base consultable)
// vive en /tablas/cobros; los links viejos ?vista=registro redirigen allí
// conservando el resto de params (?urgencia= filtra el registro).

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { CobrosView } from "./CobrosView";

export const dynamic = "force-dynamic";

export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  const params = await searchParams;
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  if (vista === "registro") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "vista") continue;
      const val = Array.isArray(v) ? v[0] : v;
      if (val != null) q.set(k, val);
    }
    const qs = q.toString();
    redirect(`/tablas/cobros${qs ? `?${qs}` : ""}`);
  }
  return <CobrosView vistaFija="actuar" />;
}
