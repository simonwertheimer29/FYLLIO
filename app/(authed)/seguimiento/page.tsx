// app/(authed)/seguimiento/page.tsx
// Rediseño 2026-07-25: "Actuar hoy" → "Seguimiento". La vista recibe TODOS
// los leads (las cohortes son una PARTICIÓN del universo activo, derivada en
// cliente con lib/seguimiento/cohortes); aquí ya no se pre-filtra nada — el
// viejo pickLeadsActuarHoy era un tercer criterio paralelo de "accionable" y
// escondía casos (ver DECISIONES 2026-07-25).

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listLeads, type Lead } from "../../lib/leads/leads";
import { listDoctores } from "@/lib/staff/doctores";
import { runWithCliente } from "../../lib/cliente-contexto";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../lib/clinicas-negocio";
import type { UserSession } from "../../lib/presupuestos/types";
import { SeguimientoView } from "./SeguimientoView";

// Bloque 2 P1 — doctores para el AgendarModal in situ del panel de lead
// (mismo patrón que leads/page.tsx).

export const dynamic = "force-dynamic";

export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La vista y la cohorte se resuelven en SERVIDOR: leerlas de
  // window.location en el estado inicial provocaba un mismatch de
  // hidratación (React #418) con ?vista=presupuestos.
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const vistaInicial = one(params.vista) === "presupuestos" ? "presupuestos" : "leads";
  const cohorteInicial = one(params.cohorte);

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
  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return (
    <SeguimientoView
      user={user}
      initialLeads={leadsConClinica}
      doctores={doctores}
      vistaInicial={vistaInicial}
      cohorteInicial={cohorteInicial}
    />
  );
}
