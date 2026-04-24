// app/(authed)/ajustes/clinica-equipo/page.tsx
// Sprint 7 Fase 6 — carga datos server-side y delega UI al client view.

import { listClinicas, listUsuariosConClinicas } from "../../../lib/auth/users";
import { ClinicaEquipoView } from "./ClinicaEquipoView";

export const dynamic = "force-dynamic";

export default async function ClinicaEquipoPage() {
  const [clinicas, usuarios] = await Promise.all([
    listClinicas(),
    listUsuariosConClinicas(),
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
