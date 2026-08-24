// F2: el agente conversacional vive en /agentes/conversacional (grupo
// Agentes de IA). Redirect permanente para marcadores.
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function AgenteRedirect() {
  redirect("/agentes/conversacional");
}
