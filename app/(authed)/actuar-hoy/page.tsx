// app/(authed)/actuar-hoy/page.tsx
// Sprint 8 D.2 — "Actuar hoy" = cola priorizada por IA.
// Sprint 9 G.5 — se añade una sección superior con los leads accionables
// del día (Citados Hoy + Nuevos + Contactado >48h). Presupuestos sigue
// debajo como la sección principal.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listLeads, type Lead } from "../../lib/leads/leads";
import { base, TABLES, fetchAll, runWithCliente } from "../../lib/airtable";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../lib/clinicas-negocio";
import type { UserSession } from "../../lib/presupuestos/types";
import { ActuarHoyView } from "./ActuarHoyView";

// Bloque 2 P1 — doctores para el AgendarModal in situ del panel de lead
// (mismo patrón que leads/page.tsx).
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

  // Sprint B — listLeads llama a base(); fijar el contexto de cliente. Filtramos
  // por IDs de clínica de NEGOCIO y remapeamos a IDs centrales (por nombre) para
  // que el filtro cliente-side por ClinicContext coincida.
  const { leadsConClinica, doctores } = await runWithCliente(s.cliente, async () => {
    const scope = await clinicasNegocioAccesibles(s);
    const [leads, doctoresRaw] = await Promise.all([
      listLeads({ clinicaIds: scope.ids ?? undefined }),
      listDoctores(),
    ]);
    const leadsConClinica: Lead[] = leads.map((l) => ({
      ...l,
      clinicaId: negocioIdToCentralId(scope, l.clinicaId),
      clinicaNombre: l.clinicaId ? scope.nombreById.get(l.clinicaId) ?? undefined : undefined,
    }));
    const doctores = doctoresRaw.map((d) => ({
      ...d,
      clinicaId: negocioIdToCentralId(scope, d.clinicaId),
    }));
    return { leadsConClinica, doctores };
  });
  const leadsAccionables = pickLeadsActuarHoy(leadsConClinica);

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <ActuarHoyView user={user} initialLeads={leadsAccionables} doctores={doctores} />;
}
