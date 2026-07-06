// app/(authed)/ajustes/clinica-equipo/page.tsx
// Sprint 7 Fase 6 — carga datos server-side y delega UI al client view.

import { redirect } from "next/navigation";
import { listClinicas, listUsuariosConClinicas } from "../../../lib/auth/users";
import { getSession } from "../../../lib/auth/session";
import { ClinicaEquipoView } from "./ClinicaEquipoView";

export const dynamic = "force-dynamic";

export default async function ClinicaEquipoPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Fase 4 — solo clínicas y usuarios del cliente del admin.
  const [clinicas, usuarios] = await Promise.all([
    listClinicas({ cliente: session.cliente }),
    listUsuariosConClinicas(session.cliente),
  ]);

  return (
    <ClinicaEquipoView
      initialClinicas={clinicas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        ciudad: c.ciudad,
        telefono: c.telefono,
        activa: c.activa,
      }))}
      initialUsuarios={usuarios.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        telefono: u.telefono,
        rol: u.rol,
        activo: u.activo,
        pinLength: u.pinLength,
        clinicas: u.clinicas,
      }))}
    />
  );
}
