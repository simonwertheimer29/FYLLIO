// F4a (fase F): la ficha legacy por paciente viaja con su shell a
// /pipeline/presupuestos/paciente/[nombre]. Redirect permanente.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PacienteLegacyRedirect({
  params,
}: {
  params: Promise<{ nombre: string }>;
}) {
  const { nombre } = await params;
  redirect(`/pipeline/presupuestos/paciente/${encodeURIComponent(nombre)}`);
}
