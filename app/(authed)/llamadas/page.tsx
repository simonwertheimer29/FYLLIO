// F2: Llamadas IA vive en /agentes/llamadas (grupo Agentes de IA).
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function LlamadasRedirect() {
  redirect("/agentes/llamadas");
}
