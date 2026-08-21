// app/(authed)/seguimiento/page.tsx
// P2 (18-08): la vista de las tres cohortes se alimenta sola de
// /api/seguimiento/cola. P4 (21-08): ?cohorte= acepta el vocabulario NUEVO
// (necesita_respuesta · listos_para_cerrar · fuera_de_plazo) — es lo que
// enlazan las cards de /red; cualquier otro valor se ignora.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { SeguimientoView } from "./SeguimientoView";

export const dynamic = "force-dynamic";

const COHORTES = ["necesita_respuesta", "listos_para_cerrar", "fuera_de_plazo"] as const;

export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  const params = await searchParams;
  const raw = Array.isArray(params.cohorte) ? params.cohorte[0] : params.cohorte;
  const cohorteInicial = (COHORTES as readonly string[]).includes(raw ?? "")
    ? (raw as (typeof COHORTES)[number])
    : null;
  return <SeguimientoView cohorteInicial={cohorteInicial} />;
}
