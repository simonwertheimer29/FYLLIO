// app/(authed)/llamadas/page.tsx
// Sprint 17 Bloque 6 — panel /llamadas (Voice IA con Vapi).

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import { llamadasOperativas } from "../../../lib/entorno";
import { LlamadasView } from "./LlamadasView";

export const dynamic = "force-dynamic";

export default async function LlamadasPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Si la integración de voz todavía no está activada, la pantalla lo DICE en
  // vez de ofrecer botones que no pueden funcionar. Se resuelve en servidor: el
  // navegador no tiene por qué conocer los nombres de las variables de entorno.
  return (
    <LlamadasView
      isAdmin={session.rol === "admin"}
      operativas={llamadasOperativas()}
    />
  );
}
