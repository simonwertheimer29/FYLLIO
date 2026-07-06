// app/(authed)/leads/page.tsx
// Server component — carga leads iniciales + lista de clínicas + doctores.
// El filtrado por ClinicContext + estado + búsqueda + fecha se hace client-side.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicas } from "../../lib/auth/users";
import { listLeads } from "../../lib/leads/leads";
import { base, TABLES, fetchAll, runWithCliente } from "../../lib/airtable";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../lib/clinicas-negocio";
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

  // Sprint B — el render llama a base() (Staff, Leads); fijar el contexto de
  // cliente. Filtramos por IDs de clínica de NEGOCIO y remapeamos cada clinicaId
  // al ID CENTRAL (por nombre) para que el filtro cliente-side por ClinicContext
  // coincida. Sin esto, el coord veía la tabla de leads vacía.
  const { allClinicas, doctores, leadsWithClinica } = await runWithCliente(
    session.cliente,
    async () => {
      const [allClinicas, scope, doctores] = await Promise.all([
        listClinicas({ onlyActivas: true, cliente: session.cliente }),
        clinicasNegocioAccesibles(session),
        listDoctores(),
      ]);
      const leads = await listLeads({
        clinicaIds: scope.ids === null ? undefined : scope.ids,
      });
      const leadsWithClinica = leads.map((l) => ({
        ...l,
        clinicaId: negocioIdToCentralId(scope, l.clinicaId),
        clinicaNombre: l.clinicaId ? scope.nombreById.get(l.clinicaId) ?? null : null,
      }));
      const doctoresCentral = doctores.map((d) => ({
        ...d,
        clinicaId: negocioIdToCentralId(scope, d.clinicaId),
      }));
      return { allClinicas, doctores: doctoresCentral, leadsWithClinica };
    },
  );

  return (
    <LeadsView
      initialLeads={leadsWithClinica}
      clinicasSelectables={allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      doctores={doctores}
    />
  );
}
