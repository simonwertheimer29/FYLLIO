// app/(authed)/sombra/agenda/desacuerdos/page.tsx
//
// DÓNDE NO COINCIDIMOS (14-09-2026). La otra mitad de /sombra/agenda: allí se
// etiqueta a ciegas, aquí se lee la comparación con la lista ya terminada.
// Instrumentación de desarrollo: fuera del menú, 404 sin esVisorSombra.

import { notFound } from "next/navigation";
import { getSession } from "../../../../lib/auth/session";
import { esVisorSombra } from "../../../../lib/agente/sombra";
import { DesacuerdosAgendaView } from "./DesacuerdosAgendaView";

export const dynamic = "force-dynamic";

export default async function DesacuerdosAgendaPage() {
  const session = await getSession();
  if (!session || !esVisorSombra(session)) notFound();
  return <DesacuerdosAgendaView />;
}
