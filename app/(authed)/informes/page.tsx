// F1: Informes vive en /resultados/informes (grupo Resultados).
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function InformesRedirect() {
  redirect("/resultados/informes");
}
