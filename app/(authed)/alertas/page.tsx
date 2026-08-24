// F3 (fase F): Alertas dejó de ser ventana — es LA CAMPANA de la barra
// lateral (interrumpe, no se visita). Redirect para marcadores.
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function AlertasRedirect() {
  redirect("/inicio");
}
