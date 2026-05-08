// app/(authed)/llamadas/page.tsx
// Sprint 17 Bloque 6 — panel /llamadas (Voice IA con Vapi).

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { LlamadasView } from "./LlamadasView";

export const dynamic = "force-dynamic";

export default async function LlamadasPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <LlamadasView isAdmin={session.rol === "admin"} />;
}
