// Ruta vieja de "Actuar hoy" → redirect permanente a /seguimiento
// (rediseño 2026-07-25) preservando la query: los enlaces guardados tipo
// ?vista=presupuestos siguen funcionando, y el ?filtro= viejo de leads se
// traduce a su cohorte equivalente.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const FILTRO_A_COHORTE: Record<string, string> = {
  "sin-contactar": "nuevos",
  citados: "citados",
  esperando: "conversacion",
};

export default async function ActuarHoyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val == null) continue;
    if (k === "filtro") {
      const cohorte = FILTRO_A_COHORTE[val];
      if (cohorte) qs.set("cohorte", cohorte);
      continue;
    }
    qs.set(k, val);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  redirect(`/seguimiento${suffix}`);
}
