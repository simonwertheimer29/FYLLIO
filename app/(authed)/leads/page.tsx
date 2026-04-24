// app/(authed)/leads/page.tsx
// Server component — carga leads iniciales + lista de clínicas. El filtrado
// por ClinicContext + estado + búsqueda + fecha se hace client-side.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicas, listClinicaIdsForUser } from "../../lib/auth/users";
import { listLeads } from "../../lib/leads/leads";
import { LeadsView } from "./LeadsView";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const allClinicas = await listClinicas({ onlyActivas: true });
  const allowed =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  const leads = await listLeads({
    clinicaIds: allowed === null ? undefined : allowed,
  });

  const clinicaById = new Map(allClinicas.map((c) => [c.id, c.nombre]));
  const leadsWithClinica = leads.map((l) => ({
    ...l,
    clinicaNombre: l.clinicaId ? clinicaById.get(l.clinicaId) ?? null : null,
  }));

  return (
    <LeadsView
      initialLeads={leadsWithClinica}
      clinicasSelectables={allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }))}
    />
  );
}
