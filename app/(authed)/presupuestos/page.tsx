// F4a (fase F): el kanban de presupuestos vive en /pipeline/presupuestos (grupo Pipeline).
// Redirect permanente para marcadores y deep-links guardados (?vista=, ?tab=, ?item= y
// cualquier otro param viajan tal cual). La API /api/presupuestos CONSERVA nombre.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PresupuestosRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null) q.set(k, val);
  }
  const s = q.toString();
  redirect(`/pipeline/presupuestos${s ? `?${s}` : ""}`);
}
