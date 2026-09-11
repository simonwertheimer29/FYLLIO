// app/(authed)/sombra/page.tsx
//
// LA SOMBRA — instrumentación de desarrollo (fase 1, 11-09-2026). Fuera del
// menú; para quien no pasa esVisorSombra, la ruta no existe (404).

import { notFound } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { esVisorSombra } from "../../lib/agente/sombra";
import { SombraView } from "./SombraView";

export const dynamic = "force-dynamic";

export default async function SombraPage() {
  const session = await getSession();
  if (!session || !esVisorSombra(session)) notFound();
  return <SombraView />;
}
