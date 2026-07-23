// app/(authed)/pacientes/page.tsx
// Server component — carga pacientes filtrados por clínicas accesibles.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicas } from "../../lib/auth/users";
import { listPacientes } from "../../lib/pacientes/pacientes";
import { finanzasPorPaciente } from "../../lib/finanzas-paciente";
import { base, TABLES, fetchAll, runWithCliente } from "../../lib/airtable";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../lib/clinicas-negocio";
import { PacientesView } from "./PacientesView";

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

export default async function PacientesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Sprint B — el render llama a base() (Staff, Pacientes); fijar el contexto de
  // cliente. Los pacientes se filtran por IDs de clínica de NEGOCIO (los que
  // referencian sus enlaces), y luego se remapea cada clinicaId al ID CENTRAL
  // (por nombre) para que el filtro cliente-side por ClinicContext (IDs centrales)
  // coincida. Sin esto, el coord veía la tabla vacía (IDs de bases distintas).
  const { allClinicas, doctores, withNames } = await runWithCliente(session.cliente, async () => {
    const [allClinicas, scope, doctores] = await Promise.all([
      listClinicas({ onlyActivas: true, cliente: session.cliente }),
      clinicasNegocioAccesibles(session),
      listDoctores(),
    ]);
    const [pacientes, finanzas] = await Promise.all([
      listPacientes({
        clinicaIds: scope.ids === null ? undefined : scope.ids,
      }),
      // Dinero y aceptación DERIVADOS de presupuestos+pagos (una sola verdad);
      // los campos manuales/cache del paciente ya no se muestran.
      finanzasPorPaciente(),
    ]);
    const doctorById = new Map(doctores.map((d) => [d.id, d.nombre]));
    const withNames = pacientes.map((p) => {
      const fin = finanzas.get(p.id);
      return {
        ...p,
        clinicaId: negocioIdToCentralId(scope, p.clinicaId),
        clinicaNombre: p.clinicaId ? scope.nombreById.get(p.clinicaId) ?? null : null,
        doctorNombre: p.doctorLinkId ? doctorById.get(p.doctorLinkId) ?? null : null,
        firmado: fin?.firmado ?? 0,
        cobrado: fin?.cobrado ?? 0,
        pendienteReal: fin?.pendiente ?? 0,
        aceptadoDerivado: fin?.aceptado ?? null,
      };
    });
    // Doctores: remapear su clinicaId (negocio) a central para que la vista los
    // cruce con los pacientes (ya en IDs centrales).
    const doctoresCentral = doctores.map((d) => ({
      ...d,
      clinicaId: negocioIdToCentralId(scope, d.clinicaId),
    }));
    return { allClinicas, doctores: doctoresCentral, withNames };
  });

  return (
    <PacientesView
      initialPacientes={withNames}
      clinicas={allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      doctores={doctores}
    />
  );
}
