// app/(authed)/pacientes/page.tsx
// Server component — carga pacientes filtrados por clínicas accesibles.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import {
  listClinicas,
  listClinicaIdsForUser,
  listUsuarios,
} from "../../lib/auth/users";
import { listPacientes } from "../../lib/pacientes/pacientes";
import { base, TABLES, fetchAll } from "../../lib/airtable";
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

  const [allClinicas, allowed, doctores] = await Promise.all([
    listClinicas({ onlyActivas: true }),
    session.rol === "admin" ? Promise.resolve(null) : listClinicaIdsForUser(session.userId),
    listDoctores(),
  ]);

  const pacientes = await listPacientes({
    clinicaIds: allowed === null ? undefined : allowed,
  });

  // Enriquecer con nombres
  const clinicaById = new Map(allClinicas.map((c) => [c.id, c.nombre]));
  const doctorById = new Map(doctores.map((d) => [d.id, d.nombre]));
  const withNames = pacientes.map((p) => ({
    ...p,
    clinicaNombre: p.clinicaId ? clinicaById.get(p.clinicaId) ?? null : null,
    doctorNombre: p.doctorLinkId ? doctorById.get(p.doctorLinkId) ?? null : null,
  }));

  return (
    <PacientesView
      initialPacientes={withNames}
      clinicas={allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      doctores={doctores}
    />
  );
}
