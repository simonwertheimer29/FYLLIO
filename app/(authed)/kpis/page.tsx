// F1: KPIs vive en /resultados/kpis (grupo Resultados — «Resultados» dice
// para qué se mira; «Estadísticas/KPIs» sonaba a informe de contable).
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function KpisRedirect() {
  redirect("/resultados/kpis");
}
