// app/(authed)/cobros/page.tsx
// F5 (fase F): la cola de cobros MURIÓ como pantalla — los vencidos entran
// en las cohortes de Seguimiento por la política de cobro de cada clínica
// (los estancados y por-vencer son señal de campana, no cola). El registro
// vive en /tablas/cobros; los links viejos ?vista=registro siguen llegando.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CobrosRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  redirect("/seguimiento");
}
