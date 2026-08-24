// F1: Informes vive en /analiticas/informes (grupo Analíticas).
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function InformesRedirect() {
  redirect("/analiticas/informes");
}
