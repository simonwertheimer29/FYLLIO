// app/(authed)/leads/page.tsx
// Server component — carga leads iniciales + lista de clínicas + doctores.
// El filtrado por ClinicContext + estado + búsqueda + fecha se hace client-side.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicas, listClinicaIdsForUser } from "../../lib/auth/users";
import { listLeads } from "../../lib/leads/leads";
import { base, TABLES, fetchAll } from "../../lib/airtable";
import { LeadsView } from "./LeadsView";

export const dynamic = "force-dynamic";

async function listDoctores(): Promise<Array<{ id: string; nombre: string; clinicaId: string | null }>> {
  const recs = await fetchAll(
    base(TABLES.staff).select({ filterByFormula: "{Rol}='Dentista'" })
  );
  return recs.map((r) => {
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    return {
      id: r.id,
      nombre: String(r.fields?.["Nombre"] ?? ""),
      clinicaId: clis[0] ?? null,
    };
  });
}

export default async function LeadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [allClinicas, allowed, doctores] = await Promise.all([
    listClinicas({ onlyActivas: true }),
    session.rol === "admin" ? Promise.resolve(null) : listClinicaIdsForUser(session.userId),
    listDoctores(),
  ]);

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
      doctores={doctores}
    />
  );
}
