// app/(authed)/tablas/leads/page.tsx
// F4b (fase F): la tabla de leads — hasta ahora los leads SOLO tenían kanban,
// así que el que salía del tablero desaparecía de la vista. Tablas es la base
// consultable donde se audita: TODOS los leads, con su recorrido y sobre todo
// su RESULTADO FINAL Y SU MOTIVO (la columna existe desde ya; F7 añadirá el
// pre-relleno del motivo desde el log del agente).
//
// Mismo scoping fail-closed que el kanban (clinicasNegocioAccesibles +
// remap negocio→central para que el filtro de ClinicContext coincida). Sin
// las derivaciones de conversación del kanban: aquí se auditan hechos, no
// se trabaja la cola.

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/session";
import { listLeads } from "../../../lib/leads/leads";
import { runWithCliente } from "../../../lib/cliente-contexto";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../../lib/clinicas-negocio";
import { TablaLeadsView } from "./TablaLeadsView";

export const dynamic = "force-dynamic";

export default async function TablaLeadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const leads = await runWithCliente(session.cliente, async () => {
    const scope = await clinicasNegocioAccesibles(session);
    const lista = await listLeads({
      clinicaIds: scope.ids === null ? undefined : scope.ids,
    });
    return lista.map((l) => ({
      ...l,
      clinicaId: negocioIdToCentralId(scope, l.clinicaId),
      clinicaNombre: l.clinicaId ? scope.nombreById.get(l.clinicaId) ?? null : null,
    }));
  });

  return <TablaLeadsView leads={leads} />;
}
