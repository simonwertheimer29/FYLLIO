// F1: KPIs vive en /analiticas/kpis (grupo Analíticas).
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function KpisRedirect() {
  redirect("/analiticas/kpis");
}
