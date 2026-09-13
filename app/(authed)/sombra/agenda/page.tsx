// app/(authed)/sombra/agenda/page.tsx
//
// EL ETIQUETADO DEL CORPUS DE AGENDA (14-09-2026). Instrumentación de
// desarrollo, igual que /sombra: fuera del menú y, para quien no pasa
// esVisorSombra, la ruta no existe (404).

import { notFound } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import { esVisorSombra } from "../../../lib/agente/sombra";
import { EtiquetadoAgendaView } from "./EtiquetadoAgendaView";

export const dynamic = "force-dynamic";

export default async function EtiquetadoAgendaPage() {
  const session = await getSession();
  if (!session || !esVisorSombra(session)) notFound();
  return <EtiquetadoAgendaView />;
}
