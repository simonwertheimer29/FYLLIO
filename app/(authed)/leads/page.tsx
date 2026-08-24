// F4a (fase F): el kanban de leads vive en /pipeline/leads (grupo Pipeline).
// Redirect permanente para marcadores y deep-links guardados (?lead= y
// cualquier otro param viajan tal cual). La API /api/leads CONSERVA nombre.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadsRedirect({
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
  redirect(`/pipeline/leads${s ? `?${s}` : ""}`);
}
