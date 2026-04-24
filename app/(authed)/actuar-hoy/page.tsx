// app/(authed)/actuar-hoy/page.tsx
// Sprint 8 D.2 — "Actuar hoy" = cola priorizada por IA.
// Sprint 9 G.5 — se añade una sección superior con los leads accionables
// del día (Citados Hoy + Nuevos + Contactado >48h). Presupuestos sigue
// debajo como la sección principal.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicaIdsForUser, listClinicas } from "../../lib/auth/users";
import { listLeads, type Lead } from "../../lib/leads/leads";
import type { UserSession } from "../../lib/presupuestos/types";
import { ActuarHoyView } from "./ActuarHoyView";

export const dynamic = "force-dynamic";

function pickLeadsActuarHoy(leads: Lead[]): Lead[] {
  const today = new Date().toISOString().slice(0, 10);
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  return leads.filter((l) => {
    if (l.convertido) return false;
    // Citados hoy (con fecha_cita=today y estado Citado/Citados Hoy).
    if (
      (l.estado === "Citado" || l.estado === "Citados Hoy") &&
      l.fechaCita === today &&
      !l.asistido
    ) {
      return true;
    }
    // Nuevos sin llamar.
    if (l.estado === "Nuevo" && !l.llamado) return true;
    // Contactado desde hace >48h sin moverse.
    if (l.estado === "Contactado" && l.createdAt <= hace48h) return true;
    return false;
  });
}

export default async function ActuarHoyPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const [allClinicas, allowed] = await Promise.all([
    listClinicas({ onlyActivas: true }),
    s.rol === "admin" ? Promise.resolve(null) : listClinicaIdsForUser(s.userId),
  ]);

  const leads = await listLeads({ clinicaIds: allowed ?? undefined });
  const clinicaById = new Map(allClinicas.map((c) => [c.id, c.nombre]));
  const leadsConClinica: Lead[] = leads.map((l) => ({
    ...l,
    clinicaNombre: l.clinicaId ? clinicaById.get(l.clinicaId) ?? undefined : undefined,
  }));
  const leadsAccionables = pickLeadsActuarHoy(leadsConClinica);

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <ActuarHoyView user={user} initialLeads={leadsAccionables} />;
}
