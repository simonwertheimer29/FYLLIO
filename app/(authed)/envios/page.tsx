// app/(authed)/envios/page.tsx
// B6.4 (18-08) — la pantalla de la cola única de envíos. Delega al client view.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { EnviosView } from "./EnviosView";

export const dynamic = "force-dynamic";

export default async function EnviosPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <EnviosView />;
}
